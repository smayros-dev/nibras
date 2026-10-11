import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../../src/audit/audit.service';
import { REDIS } from '../../src/redis/redis.module';
import { createTestApp, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createUser } from '../helpers/factories';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('login throttling, lockout and global rate limits (AC-AUTH-03)', () => {
  let ctx: TestContext;
  let redis: Redis;

  beforeAll(async () => {
    ctx = await createTestApp();
    redis = ctx.app.get<Redis>(REDIS);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());
  afterEach(() => vi.restoreAllMocks());

  const login = (ip: string, body: Record<string, unknown>) =>
    ctx.http.post('/api/v1/auth/login').set('X-Forwarded-For', ip).send(body);

  it('AC-AUTH-03: 6th attempt is 429 with Retry-After; after 10 an alert email is sent and the account is locked', async () => {
    const { email, db } = ctx;
    const u = await createUser();
    const bad = { email: u.email, password: 'wrong wrong wrong' };
    for (let i = 0; i < 5; i++) await login('9.9.9.9', bad).expect(401);
    const r6 = await login('9.9.9.9', bad).expect(429);
    expect(r6.body.code).toBe('RATE_LIMITED');
    expect(r6.body.details).toEqual({ retryAfterS: 1 });
    expect(r6.headers['retry-after']).toBe('1');
    // The throttled attempt is not a failure (still 5 for this ip+email).
    expect(await redis.get(`login:fail:${sha(u.email)}:9.9.9.9`)).toBe('5');

    // Reach 10 failures for the email from distinct ips.
    for (let ip = 0; ip < 5; ip++) await login(`10.0.0.${ip}`, bad).expect(401);
    const locked = await login('10.0.0.9', { email: u.email, password: u.password }).expect(429);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    expect(locked.body.details.retryAfterS).toBeGreaterThan(895);
    expect(locked.body.details.retryAfterS).toBeLessThanOrEqual(900);
    expect(locked.headers['retry-after']).toBe(String(locked.body.details.retryAfterS));
    expect(locked.headers['set-cookie']).toBeUndefined();

    // Sent without being awaited (same timing as an unknown email's 10th failure).
    await vi.waitFor(() =>
      expect(email.findByTemplate('security.account_locked', u.email)).toHaveLength(1),
    );
    expect(email.findByTemplate('security.account_locked', u.email)[0]!.params).toMatchObject({
      minutes: 15,
    });
    const audits = await db.auditLog.findMany({ where: { action: 'auth.account_locked' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entityType: 'User', entityId: u.id, actorRole: 'ANONYMOUS' });
    expect(JSON.stringify(await redis.keys('*'))).not.toContain(u.email);

    // 15 minutes later (lock TTL expired) the right password works again.
    await redis.del(`login:lock:${sha(u.email)}`, `login:fail:${sha(u.email)}`);
    await login('10.0.0.9', { email: u.email, password: u.password }).expect(200);
  });

  it('locks an unknown email with the same response as an existing one (no enumeration)', async () => {
    const bad = { email: 'nobody@example.com', password: 'wrong wrong wrong' };
    for (let ip = 0; ip < 10; ip++) await login(`10.1.0.${ip}`, bad).expect(401);
    const locked = await login('10.1.0.99', bad).expect(429);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    expect(Object.keys(locked.body).sort()).toEqual(['code', 'details', 'message', 'requestId']);
    expect(locked.headers['retry-after']).toBeDefined();
    expect(ctx.email.sent).toHaveLength(0);
  });

  it('keys on the normalised email: case and spaces do not reset the count', async () => {
    const u = await createUser({ email: 'case@example.com' });
    for (let i = 0; i < 5; i++) {
      await login('9.9.9.8', {
        email: i % 2 ? ' CASE@Example.com ' : 'case@example.com',
        password: 'wrong wrong wrong',
      }).expect(401);
    }
    const r = await login('9.9.9.8', { email: 'Case@EXAMPLE.com', password: u.password });
    expect(r.status).toBe(429);
  });

  it('a successful login resets the ip+email pair (not the email-wide counter)', async () => {
    const u = await createUser();
    const bad = { email: u.email, password: 'wrong wrong wrong' };
    for (let i = 0; i < 4; i++) await login('9.9.9.7', bad).expect(401);
    await login('9.9.9.7', { email: u.email, password: u.password }).expect(200);
    expect(await redis.exists(`login:fail:${sha(u.email)}:9.9.9.7`)).toBe(0);
    expect(await redis.get(`login:fail:${sha(u.email)}`)).toBe('4');
    for (let i = 0; i < 5; i++) await login('9.9.9.7', bad).expect(401);
  });

  it('concurrent bad logins for one ip+email: at most 5 reach the password check, the rest are 429', async () => {
    const u = await createUser();
    const bad = { email: u.email, password: 'wrong wrong wrong' };
    const res = await Promise.all(Array.from({ length: 20 }, () => login('9.9.9.6', bad)));
    const statuses = res.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
    expect(statuses.filter((s) => s !== 401).every((s) => s === 429)).toBe(true);
    // Every 401 was counted, every reservation settled.
    expect(Number(await redis.get(`login:fail:${sha(u.email)}:9.9.9.6`))).toBe(
      statuses.filter((s) => s === 401).length,
    );
    expect(await redis.get(`login:inflight:${sha(u.email)}:9.9.9.6`)).toBe('0');
    // The backoff holds under concurrency: whether or not the 1 s backoff already ran out (argon2
    // timing), a second burst gets at most the single post-backoff attempt through.
    const again = await Promise.all(Array.from({ length: 10 }, () => login('9.9.9.6', bad)));
    expect(again.filter((r) => r.status === 401).length).toBeLessThanOrEqual(1);
    expect(again.filter((r) => r.status !== 401).every((r) => r.status === 429)).toBe(true);
  });

  it('concurrent bad logins for one email from many ips: at most 10 reach the password check, then locked', async () => {
    const u = await createUser();
    const bad = { email: u.email, password: 'wrong wrong wrong' };
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => login(`10.2.0.${i}`, bad)));
    const statuses = res.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(10);
    expect(statuses.filter((s) => s !== 401).every((s) => s === 429)).toBe(true);
    expect(await ctx.db.auditLog.count({ where: { action: 'auth.login_failed' } })).toBe(
      statuses.filter((s) => s === 401).length,
    );
    expect(Number(await redis.get(`login:fail:${sha(u.email)}`))).toBeLessThanOrEqual(10);
  });

  it('a valid access token does not lift the per-ip limit of public routes (61st login → 429)', async () => {
    const u = await createUser();
    const { accessToken } = await loginAs(ctx, u);
    // Malformed bodies (422) still count: the guard runs before validation, no argon2 needed.
    const attempt = () =>
      ctx.http
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '6.6.6.5')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({});
    for (let i = 0; i < 60; i++) await attempt().expect(422);
    const r = await attempt().expect(429);
    expect(r.body.code).toBe('RATE_LIMITED');
    expect(await redis.get('throttle:anon:6.6.6.5')).toBe('61');
    // The user budget counted them too.
    expect(Number(await redis.get(`throttle:user:${u.id}`))).toBe(61);
  });

  it('a failed audit write never un-counts a wrong password', async () => {
    const u = await createUser();
    const audit = ctx.app.get(AuditService);
    const original = audit.log.bind(audit);
    vi.spyOn(audit, 'log').mockImplementation((entry) =>
      entry.action === 'auth.login_failed' ? Promise.reject(new Error('db down')) : original(entry),
    );
    await login('9.9.9.4', { email: u.email, password: 'wrong wrong wrong' }).expect(500);
    expect(await redis.get(`login:fail:${sha(u.email)}:9.9.9.4`)).toBe('1');
    expect(await redis.get(`login:fail:${sha(u.email)}`)).toBe('1');
    expect(await redis.get(`login:inflight:${sha(u.email)}:9.9.9.4`)).toBe('0');
  });

  it('login throttle fails closed: Redis down → 503 SERVICE_UNAVAILABLE before any password check', async () => {
    const u = await createUser();
    vi.spyOn(redis, 'eval').mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await login('9.9.9.5', { email: u.email, password: u.password }).expect(503);
    expect(r.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(
      await ctx.db.auditLog.count({
        where: { action: { in: ['auth.login', 'auth.login_failed'] } },
      }),
    ).toBe(0);
  });

  it('global limiters fail open: Redis down → requests proceed with a warning', async () => {
    const logout = () => ctx.http.post('/api/v1/auth/logout').set('X-Forwarded-For', '7.7.7.6');
    for (let i = 0; i < 60; i++) await logout().expect(204);
    await logout().expect(429);
    vi.spyOn(redis, 'multi').mockImplementation(() => {
      throw new Error('ECONNREFUSED');
    });
    await logout().expect(204);
    await logout().expect(204);
    const warnings = ctx.logs
      .lines()
      .filter((l) => String(l.msg).includes('rate limiter unavailable, failing open'));
    expect(warnings).toHaveLength(1); // rate-limited warning
  });

  it('anonymous ip is limited to 60 requests per minute (61st → 429 RATE_LIMITED)', async () => {
    const logout = (ip: string) => ctx.http.post('/api/v1/auth/logout').set('X-Forwarded-For', ip);
    for (let i = 0; i < 60; i++) await logout('7.7.7.7').expect(204);
    const r = await logout('7.7.7.7').expect(429);
    expect(r.body.code).toBe('RATE_LIMITED');
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(r.body.details.retryAfterS).toBe(Number(r.headers['retry-after']));
    // Every route shares the ip's budget (login included), other ips are unaffected.
    await login('7.7.7.7', { email: 'x@example.com', password: 'wrong wrong wrong' }).expect(429);
    await logout('7.7.7.8').expect(204);
    // Unauthenticated requests to protected routes count against the ip too.
    await ctx.http.get('/api/v1/auth/sessions').set('X-Forwarded-For', '7.7.7.7').expect(429);

    // Probes and the scrape are never throttled.
    for (let i = 0; i < 3; i++) {
      await ctx.http.get('/health/live').set('X-Forwarded-For', '7.7.7.7').expect(200);
      await ctx.http.get('/metrics').set('X-Forwarded-For', '7.7.7.7').expect(200);
    }
  });

  it('authenticated user has their own 600/min budget, not the ip one', async () => {
    const u = await createUser();
    const { cookie } = await loginAs(ctx, u);
    const authed = as(ctx.http, cookie);
    // Exhaust the ip's anonymous budget: the user's requests still pass.
    for (let i = 0; i < 61; i++)
      await ctx.http.post('/api/v1/auth/logout').set('X-Forwarded-For', '6.6.6.6');
    await authed.get('/api/v1/auth/sessions').set('X-Forwarded-For', '6.6.6.6').expect(200);

    // 600 requests in the window (counter set directly instead of sending them): the 601st is 429.
    const userKey = (await redis.keys('throttle:user:*')).find((k) => k.includes(u.id));
    expect(userKey).toBeDefined();
    await redis.set(userKey!, '600', 'KEEPTTL');
    const r = await authed.get('/api/v1/auth/sessions').expect(429);
    expect(r.body.code).toBe('RATE_LIMITED');
    expect(r.headers['retry-after']).toBeDefined();
    // Another user is unaffected.
    const other = await loginAs(ctx, await createUser());
    await as(ctx.http, other.cookie).get('/api/v1/auth/sessions').expect(200);
  });

  it('health probes are not throttled', async () => {
    for (let i = 0; i < 65; i++) {
      await ctx.http.get('/health/live').set('X-Forwarded-For', '5.5.5.5').expect(200);
    }
    expect(await redis.keys('throttle:*')).toEqual([]);
  });
});
