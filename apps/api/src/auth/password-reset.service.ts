import { HttpStatus, Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Locale } from '@tt/contracts';
import type { GuardedClient, User } from '@tt/db';
import type { EmailProvider } from '@tt/providers';
import type Redis from 'ioredis';
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
import { SessionService } from './session.service';

/** PRD §8.1.2: the reset link is valid 1 h, single use. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
/** At most 3 reset requests per email address per hour (counted whether or not it has an account). */
export const FORGOT_LIMIT = 3;
export const FORGOT_WINDOW_S = 60 * 60;

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
 * 1 h, single use; issuing one retires the user's earlier ones. A reset revokes every session, a
 * change every session but the current one.
 */
@Injectable()
export class PasswordResetService implements OnModuleDestroy {
  /** Reset requests still being processed off the request path (awaited on shutdown). */
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    @Inject(DB) private readonly db: GuardedClient,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(REDIS) private readonly redis: Pick<Redis, 'set' | 'incr'>,
    private readonly policy: PasswordPolicy,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(PasswordResetService.name);
  }

  onModuleDestroy(): Promise<void> {
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
   * unknown one and a slow mail provider is not observable. `email` is already trimmed and
   * lower-cased (`ForgotPasswordSchema`; the column is citext too).
   */
  async forgot(email: string): Promise<void> {
    if (!(await this.takeForgotSlot(email))) return;
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
   * `422 PASSWORD_*` and the link stays usable. The claim is ONE statement (pattern of
   * `EmailVerificationService.verify`): the user's unused reset tokens are locked in `id` order
   * and all retired, and the password is set only if the presented token was still among them
   * once its lock was granted, so concurrent uses of one link succeed exactly once.
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
    const updated = await this.db.$queryRaw<
      {
        id: string;
        email: string;
        first_name: string;
        locale: Locale;
        platform_role: User['platformRole'];
      }[]
    >`
      WITH target AS (
        SELECT user_id FROM verification_token
        WHERE token_hash = ${tokenHash} AND purpose = 'PASSWORD_RESET'
          AND used_at IS NULL AND expires_at > now()
      ), locked AS (
        SELECT id, token_hash FROM verification_token
        WHERE user_id IN (SELECT user_id FROM target) AND purpose = 'PASSWORD_RESET'
          AND used_at IS NULL
        ORDER BY id
        FOR UPDATE
      ), retired AS (
        UPDATE verification_token t SET used_at = now()
        FROM locked l WHERE t.id = l.id
        RETURNING t.user_id, t.token_hash
      ), claimed AS (
        SELECT user_id FROM retired WHERE token_hash = ${tokenHash}
      )
      UPDATE "user" SET password_hash = ${passwordHash}, updated_at = now()
      WHERE id IN (SELECT user_id FROM claimed) AND status NOT IN ('DELETING', 'DELETED')
      RETURNING id::text AS id, email::text AS email, first_name, locale::text AS locale,
        platform_role::text AS platform_role`;
    const user = updated[0];
    if (!user) return this.failReset();

    const revoked = await this.sessions.revokeAll(user.id);
    await this.audit.log({
      action: 'auth.password_reset',
      entityType: 'User',
      entityId: user.id,
      actorOverride: {
        userId: user.id,
        role: user.platform_role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'USER',
      },
      after: { revokedSessions: revoked },
    });
    await this.sendPasswordChanged({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      locale: user.locale,
    });
  }

  /**
   * `PATCH /me/password`: wrong current password → `401 INVALID_CREDENTIALS` (audited); policy →
   * `422 PASSWORD_*`. Sets the hash and retires pending reset links in one transaction, then
   * revokes every other session of the user.
   */
  async change(
    user: AuthUser,
    currentSessionId: string | undefined,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const { passwordHash } = await this.db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
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
    const check = await this.policy.validate(newPassword);
    if (!check.ok) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, check.code, 'Password rejected');
    }
    const hash = await hashPassword(newPassword);
    await this.db.$transaction([
      this.db.user.update({ where: { id: user.id }, data: { passwordHash: hash } }),
      this.db.verificationToken.updateMany({
        where: { userId: user.id, purpose: 'PASSWORD_RESET', usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);
    const revoked = await this.sessions.revokeAll(user.id, currentSessionId);
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
    const key = `auth:password-forgot:${hashToken(email)}`;
    // Opens the window on the first request; INCR keeps the TTL.
    await this.redis.set(key, '0', 'EX', FORGOT_WINDOW_S, 'NX');
    return (await this.redis.incr(key)) <= FORGOT_LIMIT;
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
      // Same lock order as the claim in `reset` (by id), so the two cannot deadlock.
      await tx.$queryRaw`
        SELECT id FROM verification_token
        WHERE user_id = ${user.id}::uuid AND purpose = 'PASSWORD_RESET' AND used_at IS NULL
        ORDER BY id FOR UPDATE`;
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
