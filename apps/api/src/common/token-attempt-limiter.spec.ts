import { randomUUID } from 'node:crypto';
import { TOKEN_ATTEMPTS_PER_MIN } from '@nibras/contracts';
import Redis from 'ioredis';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from './api-error';
import { TokenAttemptLimiter } from './token-attempt-limiter';

// The package's own test Redis index (applyTestEnv('api') in test/setup.ts), never DB 0; every
// test gets its own key prefix, deleted in afterEach.
const admin = new Redis(process.env.REDIS_URL!);

describe('TokenAttemptLimiter', () => {
  let prefix: string;
  let redis: Redis;
  let limiter: TokenAttemptLimiter;

  beforeEach(() => {
    prefix = `sp2-t3-${randomUUID()}:`;
    redis = new Redis(process.env.REDIS_URL!, { keyPrefix: prefix });
    redis.on('error', () => undefined);
    limiter = new TokenAttemptLimiter(redis);
  });
  afterEach(async () => {
    const keys = await admin.keys(`${prefix}*`);
    if (keys.length) await admin.del(...keys);
    await redis.quit();
  });
  afterAll(async () => {
    await admin.quit();
  });

  const refusal = async (p: Promise<void>): Promise<ApiError> => {
    try {
      await p;
    } catch (err) {
      if (err instanceof ApiError) return err;
      throw err;
    }
    throw new Error('expected a refusal');
  };

  it('10 failures in a minute → assertAllowed throws 429 with retryAfterS ≤ 60; another ip unaffected', async () => {
    expect(TOKEN_ATTEMPTS_PER_MIN).toBe(10);
    for (let i = 0; i < TOKEN_ATTEMPTS_PER_MIN - 1; i++) await limiter.failed('invite', '1.1.1.1');
    await expect(limiter.assertAllowed('invite', '1.1.1.1')).resolves.toBeUndefined();

    await limiter.failed('invite', '1.1.1.1');
    const err = await refusal(limiter.assertAllowed('invite', '1.1.1.1'));
    expect(err.getStatus()).toBe(429);
    expect(err.code).toBe('RATE_LIMITED');
    const retryAfterS = (err.details as { retryAfterS: number }).retryAfterS;
    expect(retryAfterS).toBeGreaterThan(0);
    expect(retryAfterS).toBeLessThanOrEqual(60);

    await expect(limiter.assertAllowed('invite', '2.2.2.2')).resolves.toBeUndefined();
    // Scopes count separately.
    await expect(limiter.assertAllowed('guardian', '1.1.1.1')).resolves.toBeUndefined();
  });

  it('counts in a 60 s window under token-attempt:{scope}:{ip}; checking never counts', async () => {
    for (let i = 0; i < 20; i++) await limiter.assertAllowed('join', '3.3.3.3');
    expect(await redis.exists('token-attempt:join:3.3.3.3')).toBe(0);

    await limiter.failed('join', '3.3.3.3');
    expect(await redis.get('token-attempt:join:3.3.3.3')).toBe('1');
    const ttl = await redis.ttl('token-attempt:join:3.3.3.3');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });
});
