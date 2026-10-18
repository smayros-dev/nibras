import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Locale } from '@nibras/contracts';
import type { GuardedClient, Prisma, User } from '@nibras/db';
import type { EmailProvider } from '@nibras/providers';
import type Redis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { ApiError } from '../common/api-error';
import { env } from '../config/env';
import { DB } from '../db/db.module';
import { EMAIL_PROVIDER } from '../providers/providers.module';
import { REDIS } from '../redis/redis.module';
import { generateToken, hashToken } from './crypto/tokens';

/** PRD §8.1.1: the verification link is valid 24 h. */
export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
/** At most one resend per user per minute. */
export const RESEND_WINDOW_S = 60;

export type VerificationRecipient = Pick<User, 'id' | 'email' | 'firstName' | 'locale'>;

/** `${WEB_ORIGIN}/${locale}/verify-email?token=${raw}` (raw is base64url: URL-safe as is). */
export function verifyEmailLink(locale: Locale, raw: string): string {
  return `${env.WEB_ORIGIN.replace(/\/+$/, '')}/${locale}/verify-email?token=${raw}`;
}

/**
 * Email-verification tokens (`VerificationToken` purpose `EMAIL_VERIFY`): only the SHA-256 of the
 * token is stored; the raw value exists only in the emailed link. Single use, 24 h.
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    @Inject(DB) private readonly db: GuardedClient,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(REDIS) private readonly redis: Pick<Redis, 'set' | 'del'>,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(EmailVerificationService.name);
  }

  /**
   * A new token for `userId`: the caller writes `data` (`verificationToken.create`) in its own
   * transaction, then emails `raw` with {@link send}.
   */
  newToken(userId: string): { raw: string; data: Prisma.VerificationTokenUncheckedCreateInput } {
    const { raw, hash } = generateToken();
    return {
      raw,
      data: {
        userId,
        purpose: 'EMAIL_VERIFY',
        tokenHash: hash,
        expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS),
      },
    };
  }

  /**
   * Emails the verification link. A delivery failure is logged (without the link) and swallowed:
   * the account exists and the user can ask for a new link.
   */
  async send(user: VerificationRecipient, raw: string): Promise<void> {
    try {
      await this.email.send({
        to: user.email,
        templateKey: 'auth.verify_email',
        locale: user.locale,
        params: { firstName: user.firstName, link: verifyEmailLink(user.locale, raw) },
      });
    } catch (err) {
      this.logger.error(
        { userId: user.id, err: { type: err instanceof Error ? err.name : typeof err } },
        'verification email not sent',
      );
    }
  }

  /**
   * Consumes `raw` in ONE statement (no interactive transaction to hold a pooled connection while
   * waiting on a row lock). An unused, unexpired `EMAIL_VERIFY` token marks its user's pending
   * verification tokens, which are locked in `id` order and all retired; the presented token is
   * "claimed" only if it is still among them once its lock is granted (READ COMMITTED re-checks
   * `used_at IS NULL`), and then `emailVerifiedAt` is set if still null. Anything else →
   * `410 TOKEN_INVALID`.
   *
   * Deadlocks (40P01): two requests presenting DIFFERENT tokens of one user both lock the user's
   * sibling tokens. Taking those row locks in one global order (`ORDER BY id FOR UPDATE`) means
   * neither can hold a row the other already waits behind, so no lock cycle can form; the loser
   * waits, re-checks, finds its token retired and answers 410.
   */
  async verify(raw: string): Promise<void> {
    const tokenHash = hashToken(raw);
    const claimed = await this.db.$queryRaw<{ user_id: string }[]>`
      WITH target AS (
        SELECT user_id FROM verification_token
        WHERE token_hash = ${tokenHash} AND purpose = 'EMAIL_VERIFY'
          AND used_at IS NULL AND expires_at > now()
      ), locked AS (
        SELECT id, user_id, token_hash FROM verification_token
        WHERE user_id IN (SELECT user_id FROM target) AND purpose = 'EMAIL_VERIFY'
          AND used_at IS NULL
        ORDER BY id
        FOR UPDATE
      ), retired AS (
        UPDATE verification_token t SET used_at = now()
        FROM locked l WHERE t.id = l.id
        RETURNING t.user_id, t.token_hash
      ), claimed AS (
        SELECT user_id FROM retired WHERE token_hash = ${tokenHash}
      ), verified AS (
        UPDATE "user" SET email_verified_at = now(), updated_at = now()
        WHERE id IN (SELECT user_id FROM claimed) AND email_verified_at IS NULL
      )
      SELECT user_id::text AS user_id FROM claimed`;
    if (claimed.length !== 1) {
      throw new ApiError(HttpStatus.GONE, 'TOKEN_INVALID', 'Invalid or expired token');
    }
  }

  /**
   * New link for an unverified user (no-op once verified): earlier unused tokens are retired in
   * the same transaction as the new one. More than one call per user per minute →
   * `429 RATE_LIMITED`; the cooldown is released when that transaction fails.
   */
  async resend(user: VerificationRecipient & Pick<User, 'emailVerifiedAt'>): Promise<void> {
    if (user.emailVerifiedAt) return;
    const cooldownKey = `auth:resend-verification:${user.id}`;
    const slot = await this.redis.set(cooldownKey, '1', 'EX', RESEND_WINDOW_S, 'NX');
    if (slot === null) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Verification email already sent, try again in a minute',
      );
    }
    const { raw, data } = this.newToken(user.id);
    const now = new Date();
    try {
      await this.db.$transaction([
        this.db.verificationToken.updateMany({
          where: { userId: user.id, purpose: 'EMAIL_VERIFY', usedAt: null },
          data: { usedAt: now },
        }),
        this.db.verificationToken.create({ data }),
      ]);
    } catch (err) {
      // Nothing was issued: free the cooldown so the user can retry at once.
      await this.redis.del(cooldownKey).catch(() => undefined);
      throw err;
    }
    await this.send(user, raw);
  }
}
