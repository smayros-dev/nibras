import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma, type GuardedClient, type User } from '@tt/db';
import type { EmailParams, EmailProvider, EmailTemplateKey } from '@tt/providers';
import type Redis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { authenticator } from 'otplib';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import type { AuthUser } from '../common/request-context';
import { env } from '../config/env';
import { DB } from '../db/db.module';
import { EMAIL_PROVIDER } from '../providers/providers.module';
import { REDIS } from '../redis/redis.module';
import { AuthService, GONE_STATUSES, type LoginResult } from './auth.service';
import {
  findRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  RECOVERY_CODE_COUNT,
} from './crypto/recovery-codes';
import { SecretBox } from './crypto/secret-box';
import {
  CHALLENGE_TTL_S,
  CLOCK_TOLERANCE_S,
  JwtService,
  type ChallengePayload,
} from './jwt.service';
import { LoginThrottleService } from './login-throttle.service';
import { ReauthLimiter } from './reauth-limiter';
import type { SessionMeta } from './session.service';
import { requiresTwoFactor } from './two-factor.policy';

/** Name shown by authenticator apps next to the account (`otpauth://` issuer). */
export const TOTP_ISSUER = 'Nibras';

const twoFactorInvalid = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'TWO_FACTOR_INVALID', 'Invalid verification code');
const tokenInvalid = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'TOKEN_INVALID', 'Invalid or expired challenge');
const alreadyEnabled = () =>
  new ApiError(
    HttpStatus.CONFLICT,
    'TWO_FACTOR_ALREADY_ENABLED',
    'Two-factor authentication is already enabled',
  );

type SignedIn = Extract<LoginResult, { status: 'OK' }>;

/**
 * TOTP second factor (PRD §8.1.2, D-P12, AC-AUTH-05): enrolment, login challenge, recovery codes,
 * disabling.
 *
 * - The seed is sealed at rest with `TOTP_ENCRYPTION_KEY` (`SecretBox`, AES-256-GCM); a pending
 *   enrolment has `totpSecretEnc` set and `totpEnabledAt` null. Codes: RFC 6238, 30 s, 6 digits,
 *   accepted one step either side (±30 s of clock drift).
 * - Recovery codes: 10 × `xxxxx-xxxxx` (base32), returned once, stored as argon2id hashes, each
 *   consumed atomically on use.
 * - Login: `AuthService.login` answers a `challengeToken` (JWT `typ: '2fa'`, 5 min, `jti`, bound to
 *   the credentials version). Each attempt claims the `jti` in Redis (`2fa:used:{jti}`, `SET NX`,
 *   TTL = the token's lifetime), so attempts on one challenge never run concurrently and a
 *   challenge that signed in can never be replayed (`401 TOKEN_INVALID`). A wrong code releases
 *   the claim (the user may retype) and counts as a failed login in `LoginThrottleService`
 *   (backoff after 5 per ip+email, 15-minute lock after 10 per email), so the challenge is no
 *   brute-force oracle. A challenge whose user no longer has TOTP, changed password, or was deleted
 *   is `401 TOKEN_INVALID`; a suspended one `403 ACCOUNT_SUSPENDED`.
 * - Signed-in routes that check a code (setup confirmation, disable) are limited per user by
 *   `ReauthLimiter.attemptOtp` (5 wrong codes per 15 min → `429`).
 */
@Injectable()
export class TwoFactorService {
  private readonly box = new SecretBox(env.TOTP_ENCRYPTION_KEY);
  private readonly totp = authenticator.clone({ window: 1 });

  constructor(
    @Inject(DB) private readonly db: GuardedClient,
    @Inject(REDIS) private readonly redis: Pick<Redis, 'set' | 'del'>,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
    private readonly throttle: LoginThrottleService,
    private readonly limiter: ReauthLimiter,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(TwoFactorService.name);
  }

  /**
   * Starts (or restarts) an enrolment: a new seed, sealed, 2FA still off until
   * {@link confirmSetup}. `409 TWO_FACTOR_ALREADY_ENABLED` when TOTP is on.
   */
  async beginSetup(user: AuthUser): Promise<{ secret: string; otpauthUrl: string }> {
    const secret = this.totp.generateSecret();
    const { count } = await this.db.user.updateMany({
      where: { id: user.id, totpEnabledAt: null },
      data: { totpSecretEnc: this.box.seal(secret) },
    });
    if (count === 0) throw alreadyEnabled();
    return { secret, otpauthUrl: this.totp.keyuri(user.email, TOTP_ISSUER, secret) };
  }

  /**
   * Confirms the pending enrolment with a current code: TOTP on, 10 fresh recovery codes (returned
   * this once), `security.2fa_enabled`, `auth.2fa_enabled`. Wrong code or no pending enrolment →
   * `401 TWO_FACTOR_INVALID`; already on → `409 TWO_FACTOR_ALREADY_ENABLED`.
   */
  async confirmSetup(user: AuthUser, otpCode: string): Promise<{ recoveryCodes: string[] }> {
    const row = await this.db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { totpSecretEnc: true, totpEnabledAt: true },
    });
    if (row.totpEnabledAt !== null) throw alreadyEnabled();
    if (row.totpSecretEnc === null) throw twoFactorInvalid();
    await this.checkSignedInCode(user.id, row.totpSecretEnc, otpCode);

    const recoveryCodes = generateRecoveryCodes();
    const hashes: string[] = [];
    // One at a time: each argon2 hash takes 19 MiB.
    for (const code of recoveryCodes) hashes.push(await hashRecoveryCode(code));
    // Only the very seed that was checked gets enabled (a concurrent re-setup changes it).
    const { count } = await this.db.user.updateMany({
      where: { id: user.id, totpEnabledAt: null, totpSecretEnc: row.totpSecretEnc },
      data: { totpEnabledAt: new Date(), recoveryCodesHash: hashes },
    });
    if (count === 0) throw alreadyEnabled();

    await this.audit.log({
      action: 'auth.2fa_enabled',
      entityType: 'User',
      entityId: user.id,
      after: { recoveryCodeCount: RECOVERY_CODE_COUNT },
    });
    await this.sendEmail(user, 'security.2fa_enabled', { firstName: user.firstName });
    return { recoveryCodes };
  }

  /** Completes a `TWO_FACTOR_REQUIRED` login with a TOTP code (see the class comment). */
  verifyLogin(
    challengeToken: string,
    otpCode: string,
    opts: SessionMeta & { remember: boolean },
  ): Promise<SignedIn> {
    return this.completeChallenge(
      challengeToken,
      opts,
      'totp',
      async (user) => user.totpSecretEnc !== null && this.codeMatches(user.totpSecretEnc, otpCode),
    );
  }

  /**
   * Completes a `TWO_FACTOR_REQUIRED` login with a recovery code, which is consumed;
   * `security.recovery_code_used { remaining }` and `auth.recovery_code_used` follow.
   */
  async verifyRecovery(
    challengeToken: string,
    recoveryCode: string,
    opts: SessionMeta & { remember: boolean },
  ): Promise<SignedIn> {
    let remaining = 0;
    const result = await this.completeChallenge(challengeToken, opts, 'recovery', async (user) => {
      const index = await findRecoveryCode(user.recoveryCodesHash, recoveryCode);
      if (index < 0) return false;
      const left = await this.consumeRecoveryCode(user.id, user.recoveryCodesHash[index]!);
      // `null`: a concurrent request consumed the same code first.
      if (left === null) return false;
      remaining = left;
      return true;
    });
    await this.audit.log({
      action: 'auth.recovery_code_used',
      entityType: 'User',
      entityId: result.user.id,
      actorOverride: { userId: result.user.id, role: roleOf(result.user) },
      after: { remaining },
    });
    await this.sendEmail(result.user, 'security.recovery_code_used', {
      firstName: result.user.firstName,
      remaining,
    });
    return result;
  }

  /**
   * Turns TOTP off (seed and recovery codes erased), `security.2fa_disabled`, `auth.2fa_disabled`.
   * `403 TWO_FACTOR_MANDATORY` when the user's role requires 2FA (checked first); TOTP off or
   * wrong code → `401 TWO_FACTOR_INVALID`.
   */
  async disable(user: AuthUser, otpCode: string): Promise<void> {
    if (await requiresTwoFactor(user)) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'TWO_FACTOR_MANDATORY',
        'Two-factor authentication is mandatory for this account',
      );
    }
    const row = await this.db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { totpSecretEnc: true, totpEnabledAt: true },
    });
    if (row.totpEnabledAt === null || row.totpSecretEnc === null) throw twoFactorInvalid();
    await this.checkSignedInCode(user.id, row.totpSecretEnc, otpCode);

    const { count } = await this.db.user.updateMany({
      where: { id: user.id, totpEnabledAt: { not: null } },
      data: { totpSecretEnc: null, totpEnabledAt: null, recoveryCodesHash: [] },
    });
    if (count === 0) return; // A concurrent disable already did it.
    await this.audit.log({ action: 'auth.2fa_disabled', entityType: 'User', entityId: user.id });
    await this.sendEmail(user, 'security.2fa_disabled', { firstName: user.firstName });
  }

  /**
   * Shared login-challenge flow: verify the token, claim its `jti`, load the user, run the login
   * throttle around `check`, then `AuthService.completeLogin`.
   */
  private async completeChallenge(
    challengeToken: string,
    opts: SessionMeta & { remember: boolean },
    secondFactor: 'totp' | 'recovery',
    check: (user: User) => Promise<boolean>,
  ): Promise<SignedIn> {
    let payload: ChallengePayload;
    try {
      payload = await this.jwt.verify(challengeToken, '2fa');
    } catch {
      throw tokenInvalid();
    }
    const usedKey = `2fa:used:${payload.jti}`;
    if (!(await this.claim(usedKey))) throw tokenInvalid();

    // Released only when the attempt failed in a way the user can retry (wrong code, throttled,
    // transient error); kept once the challenge signed in or can never succeed.
    let keepClaim = false;
    try {
      const user = await this.db.user.findUnique({ where: { id: payload.sub } });
      if (
        !user ||
        GONE_STATUSES.has(user.status) ||
        user.totpEnabledAt === null ||
        user.credentialsVersion !== payload.cv
      ) {
        keepClaim = true;
        throw tokenInvalid();
      }
      if (user.status !== 'ACTIVE') {
        keepClaim = true;
        throw new ApiError(HttpStatus.FORBIDDEN, 'ACCOUNT_SUSPENDED', 'Account suspended');
      }

      const gate = await this.throttle.check(user.email, opts.ip);
      if (!gate.allowed) {
        throw new ApiError(
          HttpStatus.TOO_MANY_REQUESTS,
          gate.code,
          gate.code === 'ACCOUNT_LOCKED' ? 'Account temporarily locked' : 'Too many login attempts',
          { retryAfterS: gate.retryAfterS },
        );
      }
      let settled = false;
      try {
        if (!(await check(user))) {
          // Counted before the audit write: an audit error must never un-count the attempt.
          settled = true;
          await this.throttle.recordFailure(user.email, opts.ip, user);
          await this.auth.auditFailure(user, user.email, 'two_factor_invalid');
          throw twoFactorInvalid();
        }
        settled = true;
        await this.throttle.reset(user.email, opts.ip);
      } finally {
        if (!settled) await this.throttle.release(user.email, opts.ip);
      }

      keepClaim = true;
      return await this.auth.completeLogin(user, opts, {
        remember: opts.remember,
        credentialsVersion: payload.cv,
        secondFactor,
      });
    } finally {
      if (!keepClaim) await this.redis.del(usedKey).catch(() => undefined);
    }
  }

  /** `SET NX` of a challenge's `jti`; Redis down → `503` (fail closed, no unthrottled oracle). */
  private async claim(key: string): Promise<boolean> {
    try {
      const reply = await this.redis.set(key, '1', 'EX', CHALLENGE_TTL_S + CLOCK_TOLERANCE_S, 'NX');
      return reply === 'OK';
    } catch {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_UNAVAILABLE',
        'Service unavailable',
      );
    }
  }

  /** A signed-in code check, limited per user (`ReauthLimiter.attemptOtp`). */
  private async checkSignedInCode(userId: string, sealed: string, otpCode: string): Promise<void> {
    await this.limiter.attemptOtp(userId);
    if (!this.codeMatches(sealed, otpCode)) throw twoFactorInvalid();
    await this.limiter.otpSucceeded(userId);
  }

  private codeMatches(sealed: string, otpCode: string): boolean {
    let secret: string;
    try {
      secret = this.box.open(sealed);
    } catch (err) {
      // Wrong key or corrupted row: never a valid code, and worth an alert.
      this.logger.error(
        { err: { type: err instanceof Error ? err.name : typeof err } },
        'totp seed unreadable',
      );
      return false;
    }
    try {
      return this.totp.check(otpCode, secret);
    } catch {
      return false;
    }
  }

  /**
   * Removes `hash` from the user's recovery codes in one statement (`array_remove` guarded by
   * `= ANY`), so two concurrent uses of one code cannot both succeed and the removal never
   * resurrects a code another request consumed. The codes left, or `null` when `hash` was gone.
   */
  private async consumeRecoveryCode(userId: string, hash: string): Promise<number | null> {
    const rows = await this.db.$queryRaw<{ remaining: number }[]>(Prisma.sql`
      UPDATE "user"
         SET recovery_codes_hash = array_remove(recovery_codes_hash, ${hash}),
             updated_at = now()
       WHERE id = ${userId}::uuid AND ${hash} = ANY(recovery_codes_hash)
   RETURNING cardinality(recovery_codes_hash)::int AS remaining`);
    return rows[0]?.remaining ?? null;
  }

  private async sendEmail<K extends EmailTemplateKey>(
    user: Pick<User, 'id' | 'email' | 'locale'>,
    templateKey: K,
    params: EmailParams<K>,
  ): Promise<void> {
    try {
      await this.email.send({ to: user.email, templateKey, locale: user.locale, params });
    } catch (err) {
      this.logger.error(
        {
          userId: user.id,
          templateKey,
          err: { type: err instanceof Error ? err.name : typeof err },
        },
        'two-factor email not sent',
      );
    }
  }
}

function roleOf(user: Pick<User, 'platformRole'>): string {
  return user.platformRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'USER';
}
