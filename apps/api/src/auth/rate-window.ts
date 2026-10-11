import { HttpStatus } from '@nestjs/common';
import type Redis from 'ioredis';
import { ApiError } from '../common/api-error';

export type RateRedis = Pick<Redis, 'multi' | 'del'>;

/**
 * Counts one hit in the fixed window `key` (`windowS` seconds) and returns the new count and the
 * seconds left. `INCR` and `EXPIRE … NX` run in one `MULTI`, so the key can never exist without a
 * TTL: a key left without one (e.g. by an older non-atomic writer) gets it on the next hit, and a
 * hit that recreates the key just after it expired sets a fresh TTL in the same transaction.
 */
export async function hitWindow(
  redis: RateRedis,
  key: string,
  windowS: number,
): Promise<{ count: number; ttl: number }> {
  const results = await redis.multi().incr(key).expire(key, windowS, 'NX').ttl(key).exec();
  if (!results) throw new Error('rate window transaction aborted');
  for (const [err] of results) if (err) throw err;
  const count = Number(results[0]![1]);
  const ttl = Number(results[2]![1]);
  return { count, ttl: ttl > 0 ? ttl : windowS };
}

/** `429 RATE_LIMITED` with `details.retryAfterS` (the exception filter sends `Retry-After`). */
export function rateLimited(retryAfterS: number, message: string): ApiError {
  return new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', message, { retryAfterS });
}
