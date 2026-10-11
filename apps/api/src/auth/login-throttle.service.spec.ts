import { createHash, randomUUID } from 'node:crypto';
import type { User } from '@tt/db';
import { InMemoryEmailProvider } from '@tt/providers';
import Redis from 'ioredis';
import type { PinoLogger } from 'nestjs-pino';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service';
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
  let t: LoginThrottleService;

  beforeEach(() => {
    prefix = `t8-${randomUUID()}:`;
    redis = new Redis(process.env.REDIS_URL!, { keyPrefix: prefix });
    email = new InMemoryEmailProvider();
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    const logger = { setContext: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
    t = new LoginThrottleService(redis, audit as unknown as AuditService, email, logger);
  });
  afterEach(async () => {
    const keys = await admin.keys(`${prefix}*`);
    if (keys.length) await admin.del(...keys);
    redis.disconnect();
  });
  afterAll(() => admin.disconnect());

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

  it('caps the backoff at 60 s and lets the next attempt through once the backoff expired', async () => {
    for (let i = 0; i < 5; i++) await t.recordFailure('a@x.io', '1.1.1.1');
    // The backoff expires (TTL manipulation instead of sleeping): one more attempt is allowed.
    const backoff = (await redis.keys(`${prefix}login:backoff:*`)).map((k) =>
      k.slice(prefix.length),
    );
    expect(backoff).toHaveLength(1);
    await redis.del(backoff[0]!);
    expect(await t.check('a@x.io', '1.1.1.1')).toEqual({ allowed: true });

    for (let i = 0; i < 4; i++) await t.recordFailure('a@x.io', '3.3.3.3');
    for (let i = 0; i < 6; i++) await t.recordFailure('b@x.io', '4.4.4.4');
    expect(await t.check('b@x.io', '4.4.4.4')).toMatchObject({ retryAfterS: 2 });
    // 12 failures for one ip+email inside the minute: 2 ** 7 = 128 → capped at 60.
    for (let i = 0; i < 5; i++) await t.recordFailure('c@x.io', '5.5.5.5');
    await redis.set(`login:fail:${sha('c@x.io')}:5.5.5.5`, '11', 'KEEPTTL');
    await t.recordFailure('c@x.io', '5.5.5.5');
    expect(await t.check('c@x.io', '5.5.5.5')).toMatchObject({ code: 'RATE_LIMITED' });
    const r = await t.check('c@x.io', '5.5.5.5');
    expect(r.allowed === false && r.retryAfterS).toBe(60);
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

  it('locks the account for 15 minutes after 10 failures and reports ACCOUNT_LOCKED', async () => {
    for (let i = 0; i < 10; i++) await t.recordFailure('a@x.io', `10.0.0.${i}`, user);
    const res = await t.check('a@x.io', '10.0.0.200');
    expect(res).toMatchObject({ allowed: false, code: 'ACCOUNT_LOCKED' });
    expect(res.allowed === false && res.retryAfterS).toBeGreaterThan(895);
    expect(res.allowed === false && res.retryAfterS).toBeLessThanOrEqual(900);
    // The lock wins over the per-ip backoff.
    expect(await t.check('a@x.io', '10.0.0.9')).toMatchObject({ code: 'ACCOUNT_LOCKED' });

    expect(email.findByTemplate('security.account_locked', 'a@x.io')).toHaveLength(1);
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

    // Racing failures past the threshold never send a second email.
    await t.recordFailure('a@x.io', '10.0.0.100', user);
    expect(email.findByTemplate('security.account_locked')).toHaveLength(1);

    // The lock expires after 15 minutes (TTL manipulation instead of sleeping).
    await redis.del(`login:lock:${sha('a@x.io')}`);
    expect(await t.check('a@x.io', '10.0.0.200')).toEqual({ allowed: true });
  });

  it('locks an unknown email exactly like a real one (no enumeration) but mails no one', async () => {
    for (let i = 0; i < 10; i++) await t.recordFailure('ghost@x.io', `10.0.0.${i}`);
    expect(await t.check('ghost@x.io', '10.0.0.200')).toMatchObject({
      allowed: false,
      code: 'ACCOUNT_LOCKED',
    });
    expect(email.sent).toHaveLength(0);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.account_locked',
        after: expect.objectContaining({ emailSha256: sha('ghost@x.io') }),
      }),
    );
  });

  it('reset clears the ip+email and email counters', async () => {
    for (let i = 0; i < 5; i++) await t.recordFailure('a@x.io', '1.1.1.1');
    for (let i = 0; i < 4; i++) await t.recordFailure('a@x.io', '2.2.2.2');
    await t.reset('A@x.io', '1.1.1.1');
    expect(await t.check('a@x.io', '1.1.1.1')).toEqual({ allowed: true });
    expect(await redis.exists(`login:fail:${sha('a@x.io')}`)).toBe(0);
  });
});
