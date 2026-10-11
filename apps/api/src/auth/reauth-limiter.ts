import { Inject, Injectable } from '@nestjs/common';
import { REDIS } from '../redis/redis.module';
import { hitWindow, rateLimited, type RateRedis } from './rate-window';

/**
 * Wrong current passwords allowed per user per window before `429` (`PATCH /me/password` and
 * `POST /me/email-change` share the count).
 */
export const REAUTH_MAX_FAILURES = 5;
export const REAUTH_WINDOW_S = 15 * 60;
/** Email-change requests per user per window, successful ones included (stops email bombing). */
export const EMAIL_CHANGE_MAX_REQUESTS = 3;
export const EMAIL_CHANGE_WINDOW_S = 60 * 60;

/**
 * Per-user limits on the signed-in routes that re-check the password, so that a stolen session
 * cannot be used to guess the password or to flood an inbox with confirmation emails.
 */
@Injectable()
export class ReauthLimiter {
  constructor(@Inject(REDIS) private readonly redis: RateRedis) {}

  /**
   * Call before checking a password: counts the attempt first (atomic, so concurrent guesses
   * cannot exceed the limit) and refuses with `429 RATE_LIMITED` past
   * {@link REAUTH_MAX_FAILURES} attempts in the window. {@link succeeded} clears the count, so
   * only wrong passwords accumulate.
   */
  async attempt(userId: string): Promise<void> {
    const { count, ttl } = await hitWindow(this.redis, attemptsKey(userId), REAUTH_WINDOW_S);
    if (count > REAUTH_MAX_FAILURES) {
      throw rateLimited(ttl, 'Too many wrong passwords, try again later');
    }
  }

  /** The password was right: the count starts over. */
  async succeeded(userId: string): Promise<void> {
    await this.redis.del(attemptsKey(userId));
  }

  /** Counts an email-change request; beyond {@link EMAIL_CHANGE_MAX_REQUESTS} → `429`. */
  async takeEmailChangeSlot(userId: string): Promise<void> {
    const { count, ttl } = await hitWindow(
      this.redis,
      `auth:email-change:${userId}`,
      EMAIL_CHANGE_WINDOW_S,
    );
    if (count > EMAIL_CHANGE_MAX_REQUESTS) {
      throw rateLimited(ttl, 'Too many email change requests, try again later');
    }
  }
}

function attemptsKey(userId: string): string {
  return `auth:reauth-attempts:${userId}`;
}
