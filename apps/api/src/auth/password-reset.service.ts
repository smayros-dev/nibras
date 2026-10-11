import {
  HttpStatus,
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Locale } from '@tt/contracts';
import type { GuardedClient, User } from '@tt/db';
import type { EmailProvider } from '@tt/providers';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import type { AuthUser } from '../common/request-context';
import { env } from '../config/env';
import { DB } from '../db/db.module';
import { EMAIL_PROVIDER } from '../providers/providers.module';
import { REDIS } from '../redis/redis.module';
import { hashPassword, verifyPassword } from './crypto/password';
import { PasswordPolicy } from './crypto/password-policy';
import { generateToken, hashToken } from './crypto/tokens';
import { hitWindow, type RateRedis } from './rate-window';
import { ReauthLimiter } from './reauth-limiter';
import { LoginThrottleService } from './login-throttle.service';
import { sessionRevoked } from './session.service';
import { lockAccountTokens } from './token-locks';

/** PRD §8.1.2: the reset link is valid 1 h, single use. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
/** At most 3 reset requests per email address per hour (counted whether or not it has an account). */
export const FORGOT_LIMIT = 3;
export const FORGOT_WINDOW_S = 60 * 60;
/** Reset requests processed concurrently off the request path; beyond it they are dropped. */
export const FORGOT_MAX_INFLIGHT = 100;

/** Accounts that never get a reset link (and cannot have their password reset). */
const GONE_STATUSES = new Set<User['status']>(['DELETING', 'DELETED']);

type Recipient = Pick<User, 'id' | 'email' | 'firstName' | 'locale'>;

export const tokenInvalid = () =>
  new ApiError(HttpStatus.GONE, 'TOKEN_INVALID', 'Invalid or expired token');
export const invalidCredentials = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Invalid email or password');

/** `${WEB_ORIGIN}/${locale}/reset-password?token=${raw}` (raw is base64url: URL-safe as is). */
export function resetPasswordLink(locale: Locale, raw: string): string {
  return `${env.WEB_ORIGIN.replace(/\/+$/, '')}/${locale}/reset-password?token=${raw}`;
}

/**
 * Password reset by emailed link and password change (PRD §8.1.2, AC-AUTH-06).
 *
 * Reset tokens (`VerificationToken` purpose `PASSWORD_RESET`) are stored as SHA-256 only, valid
 * 1 h, single use; issuing one retires the user's earlier ones. Setting a password (reset or
 * change) increments `User.credentialsVersion` (in SQL), revokes the sessions in the same
 * statement or transaction (all of them for a reset, all but the current one for a change),
 * retires pending reset links and deletes a pending email change. A session carries the version
 * its login read together with the verified hash; `JwtAuthGuard` and `SessionService.rotate`
 * refuse any session whose version differs from the user's, so a login that read the old hash
 * while the change was committing ends up with a dead session (no clock involved).
 * `passwordChangedAt` is stamped for display and audit only.
 */
@Injectable()
export class PasswordResetService implements OnModuleDestroy, BeforeApplicationShutdown {
  /** Reset requests still being processed off the request path (awaited on shutdown). */
  private readonly inflight = new Set<Promise<void>>();
  /** {@link FORGOT_MAX_INFLIGHT}; a field so that tests can lower it. */
  maxInflight = FORGOT_MAX_INFLIGHT;

  constructor(
    @Inject(DB) private readonly db: GuardedClient,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(REDIS) private readonly redis: RateRedis,
    private readonly policy: PasswordPolicy,
    private readonly limiter: ReauthLimiter,
    private readonly loginThrottle: LoginThrottleService,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(PasswordResetService.name);
  }

  /**
   * Both hooks run before `DbModule.onApplicationShutdown` disconnects Prisma, so the work still
   * in flight finishes against a live pool.
   */
  onModuleDestroy(): Promise<void> {
    return this.drain();
  }

  beforeApplicationShutdown(): Promise<void> {
    return this.drain();
  }

  /** Resolves once every reset request accepted so far has been processed (shutdown, tests). */
  async drain(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  /**
   * "Mot de passe oublié": never reveals whether the account exists. The request only counts the
   * attempt for this address (3/hour, beyond which it is silently ignored); the lookup, token,
   * audit and email happen after the response is sent, so a known address answers as fast as an
   * unknown one and a slow mail provider is not observable. At most {@link FORGOT_MAX_INFLIGHT}
   * such jobs run at once: past that the request is dropped with a warning (still `202`).
   * `email` is already trimmed and lower-cased (`ForgotPasswordSchema`; the column is citext).
   */
  async forgot(email: string): Promise<void> {
    if (!(await this.takeForgotSlot(email))) return;
    if (this.inflight.size >= this.maxInflight) {
      this.logger.warn(
        { inflight: this.inflight.size },
        'password reset request dropped: too many in flight',
      );
      return;
    }
    const work = this.issueReset(email).catch((err: unknown) =>
      this.logger.error(
        { err: { type: err instanceof Error ? err.name : typeof err } },
        'password reset request failed',
      ),
    );
    this.inflight.add(work);
    void work.finally(() => this.inflight.delete(work));
  }

  /**
   * Sets a new password from a reset link. A link that is unknown, of another purpose, used or
   * expired → `410 TOKEN_INVALID` (audited, without the token); a password the policy refuses →
   * `422 PASSWORD_*` and the link stays usable.
   *
   * Everything else is ONE statement: the account tokens are locked in `id` order
   * ({@link lockAccountTokens}' predicate), the user's unused reset tokens are all retired, and
   * only if the presented one was still among them once its lock was granted is the password set,
   * `credentialsVersion` incremented, every live session revoked and the pending email change
   * deleted. Concurrent uses of one link therefore succeed exactly once. Then the login throttle
   * of the address is cleared, so a locked-out owner gets back in.
   */
  async reset(raw: string, newPassword: string): Promise<void> {
    const tokenHash = hashToken(raw);
    const live = await this.db.verificationToken.findFirst({
      where: { tokenHash, purpose: 'PASSWORD_RESET', usedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!live) return this.failReset();
    const check = await this.policy.validate(newPassword);
    if (!check.ok) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, check.code, 'Password rejected');
    }
    const passwordHash = await hashPassword(newPassword);
    const now = new Date().toISOString();
    const updated = await this.db.$queryRaw<
      {
        id: string;
        email: string;
        first_name: string;
        locale: Locale;
        platform_role: User['platformRole'];
        revoked: number;
      }[]
    >`
      WITH target AS (
        SELECT user_id FROM verification_token
        WHERE token_hash = ${tokenHash} AND purpose = 'PASSWORD_RESET'
          AND used_at IS NULL AND expires_at > now()
      ), locked AS (
        SELECT id, token_hash, purpose FROM verification_token
        WHERE user_id IN (SELECT user_id FROM target)
          AND ((purpose = 'PASSWORD_RESET' AND used_at IS NULL)
            OR purpose IN ('EMAIL_CHANGE_OLD', 'EMAIL_CHANGE_NEW'))
        ORDER BY id
        FOR UPDATE
      ), retired AS (
        UPDATE verification_token t SET used_at = ${now}::timestamptz
        FROM locked l WHERE t.id = l.id AND l.purpose = 'PASSWORD_RESET'
        RETURNING t.user_id, t.token_hash
      ), claimed AS (
        SELECT user_id FROM retired WHERE token_hash = ${tokenHash}
      ), updated AS (
        UPDATE "user"
        SET password_hash = ${passwordHash}, credentials_version = credentials_version + 1,
          password_changed_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
        WHERE id IN (SELECT user_id FROM claimed) AND status NOT IN ('DELETING', 'DELETED')
        RETURNING id, email, first_name, locale, platform_role
      ), revoked AS (
        UPDATE user_session SET revoked_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
        WHERE user_id IN (SELECT id FROM updated) AND revoked_at IS NULL
        RETURNING id
      ), dropped AS (
        DELETE FROM verification_token t USING locked l
        WHERE t.id = l.id AND l.purpose IN ('EMAIL_CHANGE_OLD', 'EMAIL_CHANGE_NEW')
          AND t.user_id IN (SELECT id FROM updated)
      )
      SELECT u.id::text AS id, u.email::text AS email, u.first_name, u.locale::text AS locale,
        u.platform_role::text AS platform_role, (SELECT count(*) FROM revoked)::int AS revoked
      FROM updated u`;
    const user = updated[0];
    if (!user) return this.failReset();
    // Lockout-DoS escape hatch (Task 8): the owner proved control of the address.
    try {
      await this.loginThrottle.clearForEmail(user.email);
    } catch (err) {
      this.logger.warn(
        { userId: user.id, err: { type: err instanceof Error ? err.name : typeof err } },
        'login throttle not cleared after password reset',
      );
    }

    await this.audit.log({
      action: 'auth.password_reset',
      entityType: 'User',
      entityId: user.id,
      actorOverride: {
        userId: user.id,
        role: user.platform_role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'USER',
      },
      after: { revokedSessions: user.revoked },
    });
    await this.sendPasswordChanged({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      locale: user.locale,
    });
  }

  /**
   * `PATCH /me/password`: more than 5 wrong current passwords in 15 min → `429 RATE_LIMITED`
   * (`ReauthLimiter`); wrong current password → `401 INVALID_CREDENTIALS` (audited); policy →
   * `422 PASSWORD_*`. One transaction sets the hash and increments `credentialsVersion` (only if
   * it is still the version read with the verified hash: a reset committed meanwhile wins and this
   * answers `401 SESSION_REVOKED`), retires pending reset links, deletes a pending email change,
   * revokes every other session and moves the current session to the new version (it just proved
   * the password, so it stays valid).
   */
  async change(
    user: AuthUser,
    currentSessionId: string | undefined,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.limiter.attempt(user.id);
    const { passwordHash, credentialsVersion } = await this.db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, credentialsVersion: true },
    });
    if (!passwordHash || !(await verifyPassword(passwordHash, currentPassword))) {
      await this.audit.log({
        action: 'auth.password_change_failed',
        entityType: 'User',
        entityId: user.id,
        after: { reason: 'invalid_credentials' },
      });
      throw invalidCredentials();
    }
    await this.limiter.succeeded(user.id);
    const check = await this.policy.validate(newPassword);
    if (!check.ok) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, check.code, 'Password rejected');
    }
    const hash = await hashPassword(newPassword);
    const now = new Date();
    const revoked = await this.db.$transaction(async (tx) => {
      await lockAccountTokens(tx, user.id);
      const bumped = await tx.user.updateMany({
        where: { id: user.id, credentialsVersion },
        data: {
          passwordHash: hash,
          passwordChangedAt: now,
          credentialsVersion: { increment: 1 },
        },
      });
      if (bumped.count !== 1) throw sessionRevoked();
      await tx.verificationToken.updateMany({
        where: { userId: user.id, purpose: 'PASSWORD_RESET', usedAt: null },
        data: { usedAt: now },
      });
      await tx.verificationToken.deleteMany({
        where: { userId: user.id, purpose: { in: ['EMAIL_CHANGE_OLD', 'EMAIL_CHANGE_NEW'] } },
      });
      const { count } = await tx.userSession.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
          ...(currentSessionId !== undefined && { id: { not: currentSessionId } }),
        },
        data: { revokedAt: now },
      });
      if (currentSessionId !== undefined) {
        await tx.userSession.updateMany({
          where: { id: currentSessionId, userId: user.id },
          data: { credentialsVersion: credentialsVersion + 1 },
        });
      }
      return count;
    });
    await this.audit.log({
      action: 'auth.password_changed',
      entityType: 'User',
      entityId: user.id,
      after: { revokedSessions: revoked },
    });
    await this.sendPasswordChanged(user);
  }

  /**
   * Counts a request for `email` (keyed by its SHA-256, so the address is not stored in Redis);
   * `false` beyond {@link FORGOT_LIMIT} in the window.
   */
  private async takeForgotSlot(email: string): Promise<boolean> {
    const { count } = await hitWindow(
      this.redis,
      `auth:password-forgot:${hashToken(email)}`,
      FORGOT_WINDOW_S,
    );
    return count <= FORGOT_LIMIT;
  }

  /** Off the request path: new token for a known, not deleted account, audit, email. */
  private async issueReset(email: string): Promise<void> {
    const user = await this.db.user.findUnique({
      where: { email },
      select: { id: true, email: true, firstName: true, locale: true, status: true },
    });
    if (!user || GONE_STATUSES.has(user.status)) return;
    const { raw, hash } = generateToken();
    await this.db.$transaction(async (tx) => {
      await lockAccountTokens(tx, user.id);
      await tx.verificationToken.updateMany({
        where: { userId: user.id, purpose: 'PASSWORD_RESET', usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.verificationToken.create({
        data: {
          userId: user.id,
          purpose: 'PASSWORD_RESET',
          tokenHash: hash,
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      });
    });
    await this.audit.log({
      action: 'auth.password_reset_requested',
      entityType: 'User',
      entityId: user.id,
    });
    try {
      await this.email.send({
        to: user.email,
        templateKey: 'auth.password_reset',
        locale: user.locale,
        params: { firstName: user.firstName, link: resetPasswordLink(user.locale, raw) },
      });
    } catch (err) {
      this.logger.error(
        { userId: user.id, err: { type: err instanceof Error ? err.name : typeof err } },
        'password reset email not sent',
      );
    }
  }

  /** Audits a refused reset link (anonymous request; nothing about the token) and throws 410. */
  private async failReset(): Promise<never> {
    await this.audit.log({
      action: 'auth.password_reset_failed',
      entityType: 'User',
      after: { reason: 'token_invalid' },
    });
    throw tokenInvalid();
  }

  private async sendPasswordChanged(user: Recipient): Promise<void> {
    try {
      await this.email.send({
        to: user.email,
        templateKey: 'security.password_changed',
        locale: user.locale,
        params: { firstName: user.firstName },
      });
    } catch (err) {
      this.logger.error(
        { userId: user.id, err: { type: err instanceof Error ? err.name : typeof err } },
        'password changed email not sent',
      );
    }
  }
}
