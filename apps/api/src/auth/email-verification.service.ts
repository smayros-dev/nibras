import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Locale } from '@tt/contracts';
import type { GuardedClient, Prisma, User } from '@tt/db';
import type { EmailProvider } from '@tt/providers';
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
    @Inject(REDIS) private readonly redis: Pick<Redis, 'set'>,
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
   * waiting on a row lock): an unused, unexpired `EMAIL_VERIFY` token is claimed (concurrent uses:
   * the row lock lets exactly one win), the user's `emailVerifiedAt` is set if still null and the
   * user's other pending verification tokens are retired. Anything else → `410 TOKEN_INVALID`.
   */
  async verify(raw: string): Promise<void> {
    const tokenHash = hashToken(raw);
    const claimed = await this.db.$queryRaw<{ user_id: string }[]>`
      WITH claimed AS (
        UPDATE verification_token SET used_at = now()
        WHERE token_hash = ${tokenHash} AND purpose = 'EMAIL_VERIFY'
          AND used_at IS NULL AND expires_at > now()
        RETURNING user_id
      ), verified AS (
        UPDATE "user" SET email_verified_at = now(), updated_at = now()
        WHERE id IN (SELECT user_id FROM claimed) AND email_verified_at IS NULL
      ), retired AS (
        UPDATE verification_token SET used_at = now()
        WHERE user_id IN (SELECT user_id FROM claimed) AND purpose = 'EMAIL_VERIFY'
          AND used_at IS NULL AND token_hash <> ${tokenHash}
      )
      SELECT user_id::text AS user_id FROM claimed`;
    if (claimed.length !== 1) {
      throw new ApiError(HttpStatus.GONE, 'TOKEN_INVALID', 'Invalid or expired token');
    }
  }

  /**
   * New link for an unverified user (no-op once verified): earlier unused tokens are retired in
   * the same transaction as the new one. More than one call per user per minute →
   * `429 RATE_LIMITED`.
   */
  async resend(user: VerificationRecipient & Pick<User, 'emailVerifiedAt'>): Promise<void> {
    if (user.emailVerifiedAt) return;
    const slot = await this.redis.set(
      `auth:resend-verification:${user.id}`,
      '1',
      'EX',
      RESEND_WINDOW_S,
      'NX',
    );
    if (slot === null) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Verification email already sent, try again in a minute',
      );
    }
    const { raw, data } = this.newToken(user.id);
    const now = new Date();
    await this.db.$transaction([
      this.db.verificationToken.updateMany({
        where: { userId: user.id, purpose: 'EMAIL_VERIFY', usedAt: null },
        data: { usedAt: now },
      }),
      this.db.verificationToken.create({ data }),
    ]);
    await this.send(user, raw);
  }
}
