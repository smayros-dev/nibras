import { HttpStatus } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Response } from 'express';
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

/** `429 RATE_LIMITED` with `details.retryAfterSeconds` (sent as `Retry-After` by the controller). */
export function rateLimited(retryAfterSeconds: number, message: string): ApiError {
  return new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', message, {
    retryAfterSeconds,
  });
}

/** Runs `fn`; a `429 RATE_LIMITED` from {@link rateLimited} also sets `Retry-After`. */
export async function withRetryAfter<T>(res: Response, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
      const seconds = (err.details as { retryAfterSeconds?: unknown } | undefined)
        ?.retryAfterSeconds;
      if (typeof seconds === 'number') res.setHeader('Retry-After', String(Math.ceil(seconds)));
    }
    throw err;
  }
}
