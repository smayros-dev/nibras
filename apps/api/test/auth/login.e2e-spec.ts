import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authCookieOptions } from '../../src/auth/cookies';
import { emailHmac } from '../../src/auth/crypto/email-hmac';
import { createTestApp, type TestContext } from '../helpers/app';
import { cookieValue, setCookieLine, setCookies } from '../helpers/auth';
import { createUser } from '../helpers/factories';

const FIREFOX_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

describe('POST /auth/login', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  const login = (body: Record<string, unknown>, userAgent = FIREFOX_WINDOWS) =>
    ctx.http.post('/api/v1/auth/login').set('User-Agent', userAgent).send(body);

  it('logs in with cookies and audits; wrong password is 401 INVALID_CREDENTIALS and audited', async () => {
    const { db } = ctx;
    const u = await createUser({ email: 'ahmed@example.com' });
    const res = await login({ email: ' Ahmed@Example.com ', password: u.password }).expect(200);
    expect(setCookies(res).join(';')).toMatch(/nibras_access=.*HttpOnly/);
    expect(res.body.status).toBe('OK');
    expect(res.body.user).toMatchObject({ id: u.id, email: 'ahmed@example.com' });
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash|totp/i);

    const access = setCookieLine(res, 'nibras_access')!;
    expect(access).toMatch(/; Path=\/;/);
    expect(access).toMatch(/HttpOnly/);
    expect(access).toMatch(/SameSite=Lax/);
    expect(access).toMatch(/Max-Age=900;/);
    const refresh = setCookieLine(res, 'nibras_refresh')!;
    expect(refresh).toMatch(/Path=\/api\/v1\/auth/);
    expect(refresh).toMatch(/HttpOnly/);
    expect(refresh).toMatch(/SameSite=Lax/);

    const session = await db.userSession.findFirstOrThrow({ where: { userId: u.id } });
    const raw = cookieValue(res, 'nibras_refresh');
    expect(raw.startsWith(`${session.id}.`)).toBe(true);
    expect(session.refreshTokenHash).toBe(
      createHash('sha256')
        .update(raw.slice(session.id.length + 1))
        .digest('hex'),
    );
    expect(session.familyId).toBe(session.id);
    expect(session.deviceLabel).toBe('Firefox · Windows');
    expect(session.expiresAt.getTime() - Date.now()).toBeGreaterThan(29.9 * 24 * 3600 * 1000);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).lastLoginAt).toBeInstanceOf(
      Date,
    );
    const ok = await db.auditLog.findMany({ where: { action: 'auth.login' } });
    expect(ok).toHaveLength(1);
    expect(ok[0]).toMatchObject({ entityType: 'User', entityId: u.id, actorUserId: u.id });

    const bad = await login({ email: u.email, password: 'wrong wrong wrong' }).expect(401);
    expect(bad.body.code).toBe('INVALID_CREDENTIALS');
    expect(bad.headers['set-cookie']).toBeUndefined();
    const failed = await db.auditLog.findMany({ where: { action: 'auth.login_failed' } });
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ entityId: u.id, actorUserId: null, actorRole: 'ANONYMOUS' });
    expect(JSON.stringify(failed)).not.toContain('wrong wrong wrong');
  });

  it('unknown email is also 401 INVALID_CREDENTIALS (no enumeration), audited as ANONYMOUS with the keyed email HMAC', async () => {
    const u = await createUser();
    const wrong = await login({ email: u.email, password: 'wrong wrong wrong' }).expect(401);
    const unknown = await login({
      email: 'Nobody@Example.com',
      password: 'wrong wrong wrong',
    }).expect(401);
    expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.message).toBe(wrong.body.message);
    expect(Object.keys(unknown.body).sort()).toEqual(Object.keys(wrong.body).sort());

    const entry = await ctx.db.auditLog.findFirstOrThrow({
      where: { action: 'auth.login_failed', entityId: null },
    });
    expect(entry).toMatchObject({ actorUserId: null, actorRole: 'ANONYMOUS', entityType: 'User' });
    expect(entry.after).toEqual({
      emailHmac: emailHmac('nobody@example.com'),
      reason: 'invalid_credentials',
    });
    expect(JSON.stringify(entry)).not.toContain('nobody@example.com');
  });

  it('unknown email takes as long as a wrong password (argon2 runs against a dummy hash)', async () => {
    const u = await createUser();
    // Warm-up (dummy hash, JIT, connection pool).
    await login({ email: 'warmup@example.com', password: 'wrong wrong wrong' }).expect(401);
    await login({ email: u.email, password: 'wrong wrong wrong' }).expect(401);
    const time = async (email: string) => {
      const samples: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const start = performance.now();
        await login({ email, password: 'wrong wrong wrong' }).expect(401);
        samples.push(performance.now() - start);
      }
      return samples.sort((a, b) => a - b)[1]!;
    };
    const known = await time(u.email);
    const unknown = await time('ghost@example.com');
    // Without the dummy verify an unknown email answers in a few ms against ~100 ms for argon2.
    expect(unknown).toBeGreaterThan(known * 0.5);
  });

  it('suspended user cannot log in (403 ACCOUNT_SUSPENDED); the wrong password still gives 401', async () => {
    const u = await createUser({ status: 'SUSPENDED' });
    const res = await login({ email: u.email, password: u.password }).expect(403);
    expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
    expect(res.headers['set-cookie']).toBeUndefined();
    await login({ email: u.email, password: 'wrong wrong wrong' })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('INVALID_CREDENTIALS'));
    expect(await ctx.db.userSession.count()).toBe(0);
    expect(
      await ctx.db.auditLog.count({ where: { action: 'auth.login_failed', entityId: u.id } }),
    ).toBe(2);
  });

  it('an unverified user can log in (to verify or resend the link)', async () => {
    const u = await createUser({ emailVerified: false });
    const res = await login({ email: u.email, password: u.password }).expect(200);
    expect(res.body.user.emailVerifiedAt).toBeNull();
  });

  it('new device triggers security.new_device email; same device does not', async () => {
    const u = await createUser({ firstName: 'Ahmed' });
    await login({ email: u.email, password: u.password }, FIREFOX_WINDOWS).expect(200);
    let mails = ctx.email.findByTemplate('security.new_device', u.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.params).toEqual({
      firstName: 'Ahmed',
      device: 'Firefox · Windows',
      ip: expect.any(String),
    });

    await login({ email: u.email, password: u.password }, FIREFOX_WINDOWS).expect(200);
    expect(ctx.email.findByTemplate('security.new_device', u.email)).toHaveLength(1);

    await login({ email: u.email, password: u.password }, CHROME_ANDROID).expect(200);
    mails = ctx.email.findByTemplate('security.new_device', u.email);
    expect(mails).toHaveLength(2);
    expect(mails[1]!.params).toMatchObject({ device: 'Chrome · Android' });

    // A revoked session of the same device no longer counts as known.
    await ctx.db.userSession.updateMany({
      where: { userId: u.id, deviceLabel: 'Chrome · Android' },
      data: { revokedAt: new Date() },
    });
    await login({ email: u.email, password: u.password }, CHROME_ANDROID).expect(200);
    expect(ctx.email.findByTemplate('security.new_device', u.email)).toHaveLength(3);
  });

  it('remember=false yields a session cookie without Max-Age; remember=true yields Max-Age=2592000', async () => {
    const u = await createUser();
    const plain = await login({ email: u.email, password: u.password }).expect(200);
    const sessionCookie = setCookieLine(plain, 'nibras_refresh')!;
    expect(sessionCookie).not.toMatch(/Max-Age/i);
    expect(sessionCookie).not.toMatch(/Expires/i);

    const remembered = await login({ email: u.email, password: u.password, remember: true }).expect(
      200,
    );
    expect(setCookieLine(remembered, 'nibras_refresh')!).toMatch(/Max-Age=2592000;/);

    // Same 30-day server lifetime either way (planner ruling).
    const sessions = await ctx.db.userSession.findMany({
      where: { userId: u.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(sessions.map((s) => s.remember)).toEqual([false, true]);
    for (const s of sessions) {
      expect(
        Math.abs(s.expiresAt.getTime() - s.createdAt.getTime() - 30 * 86_400_000),
      ).toBeLessThan(5_000);
    }
  });

  it('cookie options carry Secure when COOKIE_SECURE is on (off in the test env)', () => {
    expect(authCookieOptions(true)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });
    expect(authCookieOptions(false)).toMatchObject({ secure: false });
  });

  it('rejects malformed input with 422 VALIDATION_FAILED and never writes the password to the logs', async () => {
    await login({ email: 'not-an-email', password: 'x' }).expect(422);
    await login({ email: 'a@example.com' }).expect(422);
    await login({ email: 'a@example.com', password: 'x'.repeat(257) }).expect(422);
    const u = await createUser();
    const ok = await login({ email: u.email, password: u.password }).expect(200);
    const logs = JSON.stringify(ctx.logs.lines());
    expect(logs).not.toContain(u.password);
    expect(logs).not.toContain(cookieValue(ok, 'nibras_access'));
    expect(logs).not.toContain(cookieValue(ok, 'nibras_refresh'));
  });
});
