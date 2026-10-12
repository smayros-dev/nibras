import { randomInt } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma, type GuardedClient } from '@tt/db';
import type { EmailProvider, SmsProvider } from '@tt/providers';
import argon2 from 'argon2';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { hitWindow, rateLimited, type RateRedis } from '../auth/rate-window';
import { ApiError } from '../common/api-error';
import type { AuthUser } from '../common/request-context';
import { env } from '../config/env';
import { DB } from '../db/db.module';
import { EMAIL_PROVIDER, SMS_PROVIDER } from '../providers/providers.module';
import { REDIS } from '../redis/redis.module';

/** A code is valid 10 minutes. */
export const PHONE_OTP_TTL_MS = 10 * 60 * 1000;
/** Verification attempts per code; the next one is `410 OTP_EXPIRED`, even with the right code. */
export const PHONE_OTP_MAX_ATTEMPTS = 5;
/** One code request per user per window (each request costs an SMS). */
export const PHONE_OTP_REQUEST_WINDOW_S = 60;

/**
 * argon2id at the OWASP minimum (19 MiB, 2 passes), like recovery codes: a 6-digit code cannot
 * resist an offline search whatever the cost, so the hash only keeps the code out of plain sight
 * in a leaked row; the online guesses are bounded by {@link PHONE_OTP_MAX_ATTEMPTS}.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
} as const;

const otpExpired = () =>
  new ApiError(HttpStatus.GONE, 'OTP_EXPIRED', 'The code has expired, request a new one');
const otpInvalid = () =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'OTP_INVALID', 'Incorrect code');

/** Six random decimal digits (leading zeros kept), from the CSPRNG. */
export function generatePhoneOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

async function otpMatches(hash: string, otpCode: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, otpCode);
  } catch {
    return false;
  }
}

function recordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';
}

/**
 * Phone verification by SMS one-time code (D-O6, PRD §8.1). The number being verified lives on
 * the pending `PhoneOtp` row, not on the user: the account's number (and `phoneVerifiedAt`)
 * changes only when a code is confirmed, so changing a verified phone keeps the old one verified
 * until then. One pending code per user (a new request replaces it); only its argon2 hash is
 * stored; the code is never logged nor audited.
 */
@Injectable()
export class PhoneService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'phoneOtp' | 'user' | '$transaction'>,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(REDIS) private readonly redis: RateRedis,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(PhoneService.name);
  }

  /**
   * `POST /me/phone/request-otp` (`phoneE164` already validated and normalised by
   * `PhoneE164Schema`). At most one request per user per minute (`429 RATE_LIMITED`, counted
   * atomically in Redis like the other per-user limits). Replaces any pending code with a fresh
   * 6-digit one valid 10 minutes, sends it by SMS (`phone.otp`) in the user's locale and, outside
   * the production tier (`APP_ENV !== 'production'`), also emails it (`phone.otp_dev`) so the
   * console SMS provider's code can be read from Mailpit (dev) or the inbox (staging). Keyed on
   * `APP_ENV`, not `NODE_ENV`: staging images run `NODE_ENV=production` with the console SMS
   * provider, which `APP_ENV=production` forbids (env.ts). A delivery failure is logged and
   * swallowed: the user asks again after the minute.
   */
  async request(user: Pick<AuthUser, 'id' | 'email' | 'locale'>, phoneE164: string): Promise<void> {
    const { count, ttl } = await hitWindow(
      this.redis,
      `phone:otp-request:${user.id}`,
      PHONE_OTP_REQUEST_WINDOW_S,
    );
    if (count > 1) throw rateLimited(ttl, 'A code was just sent, try again later');

    const otpCode = generatePhoneOtp();
    const codeHash = await argon2.hash(otpCode, ARGON2_OPTIONS);
    await this.db.$transaction(async (tx) => {
      await tx.phoneOtp.deleteMany({ where: { userId: user.id } });
      await tx.phoneOtp.create({
        data: {
          userId: user.id,
          phoneE164,
          codeHash,
          expiresAt: new Date(Date.now() + PHONE_OTP_TTL_MS),
        },
      });
    });

    await this.deliver(user.id, 'sms', () =>
      this.sms.send({
        to: phoneE164,
        templateKey: 'phone.otp',
        locale: user.locale,
        params: { otpCode },
      }),
    );
    if (env.APP_ENV !== 'production') {
      await this.deliver(user.id, 'email', () =>
        this.email.send({
          to: user.email,
          templateKey: 'phone.otp_dev',
          locale: user.locale,
          params: { otpCode },
        }),
      );
    }
  }

  /**
   * `POST /me/phone/verify-otp`. Every call first counts an attempt on the pending code (atomic
   * increment, so concurrent guesses cannot exceed the budget); then: no pending code, past
   * {@link PHONE_OTP_MAX_ATTEMPTS} attempts or expired → `410 OTP_EXPIRED`; wrong code →
   * `422 OTP_INVALID`. On success, in one transaction, the code is consumed (deleted: a
   * concurrent success finds nothing → `410`) and the user gets `phoneE164` and
   * `phoneVerifiedAt = now`; audited `phone.verified` with before/after of both fields.
   */
  async verify(user: Pick<AuthUser, 'id'>, otpCode: string): Promise<void> {
    const pending = await this.db.phoneOtp.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!pending) throw otpExpired();
    let otp: { id: string; phoneE164: string; codeHash: string; expiresAt: Date; attempts: number };
    try {
      otp = await this.db.phoneOtp.update({
        where: { id: pending.id },
        data: { attempts: { increment: 1 } },
        select: { id: true, phoneE164: true, codeHash: true, expiresAt: true, attempts: true },
      });
    } catch (err) {
      if (recordNotFound(err)) throw otpExpired(); // replaced or consumed meanwhile
      throw err;
    }
    if (otp.attempts > PHONE_OTP_MAX_ATTEMPTS || otp.expiresAt <= new Date()) throw otpExpired();
    if (!(await otpMatches(otp.codeHash, otpCode))) throw otpInvalid();

    const now = new Date();
    const before = await this.db.$transaction(async (tx) => {
      const { count } = await tx.phoneOtp.deleteMany({ where: { id: otp.id } });
      if (count === 0) return null;
      const current = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { phoneE164: true, phoneVerifiedAt: true },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { phoneE164: otp.phoneE164, phoneVerifiedAt: now },
      });
      return current;
    });
    if (!before) throw otpExpired();
    await this.audit.log({
      action: 'phone.verified',
      entityType: 'User',
      entityId: user.id,
      before: { phoneE164: before.phoneE164, phoneVerifiedAt: before.phoneVerifiedAt },
      after: { phoneE164: otp.phoneE164, phoneVerifiedAt: now },
    });
  }

  /** Logs a delivery failure (channel and error type only: no number, address or code). */
  private async deliver(
    userId: string,
    channel: 'sms' | 'email',
    send: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await send();
    } catch (err) {
      this.logger.error(
        { userId, channel, err: { type: err instanceof Error ? err.name : typeof err } },
        'phone verification code not delivered',
      );
    }
  }
}
