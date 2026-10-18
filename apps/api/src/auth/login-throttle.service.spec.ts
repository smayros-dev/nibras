import { createHash, randomUUID } from 'node:crypto';
import type { User } from '@nibras/db';
import { InMemoryEmailProvider } from '@nibras/providers';
import Redis from 'ioredis';
import type { PinoLogger } from 'nestjs-pino';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { emailHmac } from './crypto/email-hmac';
import { LoginThrottleService } from './login-throttle.service';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

// The package's own test Redis index (applyTestEnv('api') in test/setup.ts), never DB 0; every
// test gets its own key prefix, deleted in afterEach.
const admin = new Redis(process.env.REDIS_URL!);

const user = {
  id: '0190a0a0-0000-7000-8000-000000000001',
  email: 'a@x.io',
  firstName: 'Amina',
  locale: 'fr',
} as User;

describe('LoginThrottleService', () => {
  let prefix: string;
  let redis: Redis;
  let email: InMemoryEmailProvider;
  let audit: { log: ReturnType<typeof vi.fn> };
  let logger: PinoLogger;
  let t: LoginThrottleService;

  /** Simulates the 15-minute lock and the email window both running out. */
  const expireLock = async (e: string) => {
    await redis.del(`login:lock:${sha(e)}`, `login:fail:${sha(e)}`);
  };

  beforeEach(() => {
    prefix = `t8-${randomUUID()}:`;
    redis = new Redis(process.env.REDIS_URL!, { keyPrefix: prefix });
    // Teardown noise only (a socket closing under Windows); assertions never rely on it.
    redis.on('error', () => undefined);
    email = new InMemoryEmailProvider();
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    logger = { setContext: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
    t = new LoginThrottleService(redis, audit as unknown as AuditService, email, logger);
  });
  afterEach(async () => {
    const keys = await admin.keys(`${prefix}*`);
    if (keys.length) await admin.del(...keys);
    await redis.quit();
  });
  afterAll(async () => {
    await admin.quit();
  });

  it('allows 5 failures per minute then backs off exponentially', async () => {
    for (let i = 0; i < 4; i++) await t.recordFailure('a@x.io', '1.1.1.1');
    expect(await t.check('a@x.io', '1.1.1.1')).toEqual({ allowed: true });
    await t.recordFailure('a@x.io', '1.1.1.1');
    expect(await t.check('a@x.io', '1.1.1.1')).toEqual({
      allowed: false,
      code: 'RATE_LIMITED',
      retryAfterS: 1,
    });
    await t.recordFailure('a@x.io', '1.1.1.1');
    await t.recordFailure('a@x.io', '1.1.1.1');
    expect((await t.check('a@x.io', '1.1.1.1')).allowed).toBe(false);
    expect(await t.check('a@x.io', '1.1.1.1')).toMatchObject({ retryAfterS: 4 });
    expect(await t.check('a@x.io', '2.2.2.2')).toEqual({ allowed: true }); // other ip, below 10
  });

  it('caps the backoff at 60 s and lets one attempt through once the backoff expired', async () => {
    for (let i = 0; i < 5; i++) await t.recordFailure('a@x.io', '1.1.1.1');
    // The backoff expires (TTL manipulation instead of sleeping): ONE more attempt is allowed.
    await redis.del(`login:backoff:${sha('a@x.io')}:1.1.1.1`);
    expect(await t.check('a@x.io', '1.1.1.1')).toEqual({ allowed: true });
    expect(await t.check('a@x.io', '1.1.1.1')).toMatchObject({ code: 'RATE_LIMITED' });

    for (let i = 0; i < 6; i++) await t.recordFailure('b@x.io', '4.4.4.4');
    expect(await t.check('b@x.io', '4.4.4.4')).toMatchObject({ retryAfterS: 2 });
    // 12 failures for one ip+email inside the minute: 2 ** 7 = 128 → capped at 60.
    for (let i = 0; i < 5; i++) await t.recordFailure('c@x.io', '5.5.5.5');
    await redis.set(`login:fail:${sha('c@x.io')}:5.5.5.5`, '11', 'KEEPTTL');
    await t.recordFailure('c@x.io', '5.5.5.5');
    const r = await t.check('c@x.io', '5.5.5.5');
    expect(r).toMatchObject({ code: 'RATE_LIMITED' });
    expect(r.allowed === false && r.retryAfterS).toBe(60);
  });

  it('reserves attempts atomically: 20 concurrent checks for one ip+email let only 5 through', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => t.check('a@x.io', '1.1.1.1')),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(
      results.filter((r) => !r.allowed).every((r) => !r.allowed && r.code === 'RATE_LIMITED'),
    ).toBe(true);
    // The 5 reserved attempts fail: the backoff starts, nothing else gets through.
    await Promise.all(Array.from({ length: 5 }, () => t.recordFailure('a@x.io', '1.1.1.1')));
    expect(await t.check('a@x.io', '1.1.1.1')).toMatchObject({ code: 'RATE_LIMITED' });
    expect(await redis.get(`login:inflight:${sha('a@x.io')}:1.1.1.1`)).toBe('0');
  });

  it('reserves attempts atomically per email: 20 concurrent checks from 20 ips let only 10 through', async () => {
    const ips = Array.from({ length: 20 }, (_, i) => `10.9.0.${i}`);
    const results = await Promise.all(ips.map((ip) => t.check('a@x.io', ip)));
    const allowedIps = ips.filter((_, i) => results[i]!.allowed);
    expect(allowedIps).toHaveLength(10);
    await Promise.all(allowedIps.map((ip) => t.recordFailure('a@x.io', ip, user)));
    expect(await t.check('a@x.io', '10.9.1.1')).toMatchObject({ code: 'ACCOUNT_LOCKED' });
    expect(await redis.get(`login:fail:${sha('a@x.io')}`)).toBe('10');
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('release frees the reservation without counting a failure', async () => {
    for (let i = 0; i < 5; i++) {
      expect(await t.check('a@x.io', '1.1.1.1')).toEqual({ allowed: true });
    }
    expect(await t.check('a@x.io', '1.1.1.1')).toMatchObject({ code: 'RATE_LIMITED' });
    await t.release('a@x.io', '1.1.1.1');
    expect(await t.check('a@x.io', '1.1.1.1')).toEqual({ allowed: true });
    expect(await redis.exists(`login:fail:${sha('a@x.io')}`)).toBe(0);
  });

  it('keys on the normalised email (trim + lowercase) and stores only its SHA-256', async () => {
    for (let i = 0; i < 5; i++) await t.recordFailure('  A@X.io ', '1.1.1.1');
    expect(await t.check('a@x.io', '1.1.1.1')).toMatchObject({ allowed: false });
    const keys = await admin.keys(`${prefix}*`);
    expect(keys.sort()).toEqual(
      [
        `${prefix}login:backoff:${sha('a@x.io')}:1.1.1.1`,
        `${prefix}login:fail:${sha('a@x.io')}`,
        `${prefix}login:fail:${sha('a@x.io')}:1.1.1.1`,
      ].sort(),
    );
    expect(keys.join()).not.toContain('a@x.io');
    // Windows: 60 s per ip+email, 15 min per email.
    const ipTtl = await redis.ttl(`login:fail:${sha('a@x.io')}:1.1.1.1`);
    const emailTtl = await redis.ttl(`login:fail:${sha('a@x.io')}`);
    expect(ipTtl).toBeGreaterThan(55);
    expect(ipTtl).toBeLessThanOrEqual(60);
    expect(emailTtl).toBeGreaterThan(895);
    expect(emailTtl).toBeLessThanOrEqual(900);
  });

  it('groups IPv6 clients per /64 like the global limiter', async () => {
    for (let i = 0; i < 5; i++) await t.recordFailure('a@x.io', `2001:db8::${i + 1}`);
    expect(await t.check('a@x.io', '2001:db8::ffff')).toMatchObject({ code: 'RATE_LIMITED' });
    expect(await redis.exists(`login:fail:${sha('a@x.io')}:2001:db8::/64`)).toBe(1);
  });

  it('locks the account for 15 minutes after 10 failures and reports ACCOUNT_LOCKED', async () => {
    for (let i = 0; i < 10; i++) await t.recordFailure('a@x.io', `10.0.0.${i}`, user);
    const res = await t.check('a@x.io', '10.0.0.200');
    expect(res).toMatchObject({ allowed: false, code: 'ACCOUNT_LOCKED' });
    expect(res.allowed === false && res.retryAfterS).toBeGreaterThan(895);
    expect(res.allowed === false && res.retryAfterS).toBeLessThanOrEqual(900);
    // The lock wins over the per-ip backoff.
    expect(await t.check('a@x.io', '10.0.0.9')).toMatchObject({ code: 'ACCOUNT_LOCKED' });

    await vi.waitFor(() =>
      expect(email.findByTemplate('security.account_locked', 'a@x.io')).toHaveLength(1),
    );
    expect(email.findByTemplate('security.account_locked')[0]!.params).toEqual({
      firstName: 'Amina',
      minutes: 15,
    });
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.account_locked',
        entityType: 'User',
        entityId: user.id,
      }),
    );

    // Failures past the threshold never lock or mail again.
    await t.recordFailure('a@x.io', '10.0.0.100', user);
    expect(audit.log).toHaveBeenCalledTimes(1);

    // The lock expires after 15 minutes (TTL manipulation instead of sleeping).
    await expireLock('a@x.io');
    expect(await t.check('a@x.io', '10.0.0.200')).toEqual({ allowed: true });
  });

  it('sends the lock alert at most once per 24 h per account', async () => {
    for (let i = 0; i < 10; i++) await t.recordFailure('a@x.io', `10.0.0.${i}`, user);
    await vi.waitFor(() => expect(email.sent).toHaveLength(1));
    await expireLock('a@x.io');
    for (let i = 0; i < 10; i++) await t.recordFailure('a@x.io', `10.0.1.${i}`, user);
    expect(await t.check('a@x.io', '10.0.2.1')).toMatchObject({ code: 'ACCOUNT_LOCKED' });
    expect(audit.log).toHaveBeenCalledTimes(2); // every lock is audited
    const ttl = await redis.ttl(`login:alerted:${sha('a@x.io')}`);
    expect(ttl).toBeGreaterThan(86_000);
    // 24 h later the next lock alerts again.
    await redis.del(`login:alerted:${sha('a@x.io')}`);
    await expireLock('a@x.io');
    for (let i = 0; i < 10; i++) await t.recordFailure('a@x.io', `10.0.3.${i}`, user);
    await vi.waitFor(() => expect(email.sent).toHaveLength(2));
  });

  it('locks an unknown email exactly like a real one (no enumeration) but mails no one', async () => {
    for (let i = 0; i < 10; i++) await t.recordFailure('ghost@x.io', `10.0.0.${i}`);
    expect(await t.check('ghost@x.io', '10.0.0.200')).toMatchObject({
      allowed: false,
      code: 'ACCOUNT_LOCKED',
    });
    await new Promise((r) => setImmediate(r));
    expect(email.sent).toHaveLength(0);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.account_locked',
        after: { emailHmac: emailHmac('ghost@x.io'), minutes: 15 },
      }),
    );
    expect(emailHmac('ghost@x.io')).not.toBe(sha('ghost@x.io'));
  });

  it('reset (success) clears only the ip+email pair and its backoff, not the email counter', async () => {
    for (let i = 0; i < 5; i++) await t.recordFailure('a@x.io', '1.1.1.1');
    for (let i = 0; i < 4; i++) await t.recordFailure('a@x.io', '2.2.2.2');
    await t.reset('A@x.io', '1.1.1.1');
    expect(await t.check('a@x.io', '1.1.1.1')).toEqual({ allowed: true });
    expect(await redis.get(`login:fail:${sha('a@x.io')}`)).toBe('9');
    expect(await redis.get(`login:fail:${sha('a@x.io')}:2.2.2.2`)).toBe('4');
  });

  it('clearForEmail (completed password reset) removes the lock and every counter of the email', async () => {
    for (let i = 0; i < 6; i++) await t.recordFailure('a@x.io', '1.1.1.1', user);
    for (let i = 0; i < 4; i++) await t.recordFailure('a@x.io', '2.2.2.2', user);
    await t.recordFailure('b@x.io', '1.1.1.1');
    expect(await t.check('a@x.io', '3.3.3.3')).toMatchObject({ code: 'ACCOUNT_LOCKED' });
    await t.clearForEmail(' A@x.io');
    expect(await t.check('a@x.io', '1.1.1.1')).toEqual({ allowed: true });
    const left = (await admin.keys(`${prefix}login:*`)).map((k) => k.slice(prefix.length));
    expect(
      left
        .filter(
          (k) =>
            k.startsWith('login:fail') ||
            k.startsWith('login:lock') ||
            k.startsWith('login:backoff'),
        )
        .sort(),
    ).toEqual([`login:fail:${sha('b@x.io')}`, `login:fail:${sha('b@x.io')}:1.1.1.1`].sort());
  });

  it('fails closed: a Redis error is 503 SERVICE_UNAVAILABLE', async () => {
    vi.spyOn(redis, 'eval').mockRejectedValue(new Error('ECONNREFUSED'));
    const err = await t.check('a@x.io', '1.1.1.1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).getStatus()).toBe(503);
    expect((err as ApiError).code).toBe('SERVICE_UNAVAILABLE');
    await expect(t.recordFailure('a@x.io', '1.1.1.1')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    // Settling after a successful sign-in never throws.
    await expect(t.reset('a@x.io', '1.1.1.1')).resolves.toBeUndefined();
  });
});
