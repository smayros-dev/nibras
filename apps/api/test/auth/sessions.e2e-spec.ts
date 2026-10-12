import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateToken, hashToken } from '../../src/auth/crypto/tokens';
import { JwtService } from '../../src/auth/jwt.service';
import { SessionService } from '../../src/auth/session.service';
import { RequestContext } from '../../src/common/request-context';
import { env } from '../../src/config/env';
import { createTestApp, type TestContext } from '../helpers/app';
import { as, cookieValue, loginAs, setCookieLine } from '../helpers/auth';
import { createUser } from '../helpers/factories';

describe('sessions: refresh rotation, reuse detection, device list', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  const loginHttp = (u: { email: string; password: string }, extra: object = {}) =>
    ctx.http
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: u.password, ...extra })
      .expect(200);
  const refresh = (token: string) =>
    ctx.http.post('/api/v1/auth/refresh').set('Cookie', `tt_refresh=${token}`);
  const me = (access: string) => ctx.http.get('/api/v1/me').set('Cookie', `tt_access=${access}`);

  it('AC-AUTH-04: refresh rotates; replaying the old refresh token revokes the sessions and emails the user', async () => {
    const { db, email } = ctx;
    const u = await createUser();
    const login = await loginHttp(u);
    const refresh1 = cookieValue(login, 'tt_refresh');
    const r2 = await refresh(refresh1).expect(200);
    const refresh2 = cookieValue(r2, 'tt_refresh');
    expect(refresh2).not.toBe(refresh1);
    expect(cookieValue(r2, 'tt_access')).not.toBe(cookieValue(login, 'tt_access'));
    await me(cookieValue(r2, 'tt_access')).expect(200);

    const replay = await refresh(refresh1).expect(401);
    expect(replay.body.code).toBe('SESSION_REVOKED');
    // The reuse response clears the cookies it would otherwise have rotated.
    expect(setCookieLine(replay, 'tt_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
    await refresh(refresh2).expect(401); // whole family dead
    expect(email.findByTemplate('security.token_reuse', u.email)).toHaveLength(1);
    expect(email.findByTemplate('security.token_reuse', u.email)[0]!.params).toEqual({
      firstName: u.firstName,
    });
    await me(cookieValue(r2, 'tt_access'))
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('SESSION_REVOKED'));

    expect(await db.userSession.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
    const audit = await db.auditLog.findMany({ where: { action: 'auth.refresh_reuse_detected' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityType: 'UserSession', actorRole: 'ANONYMOUS' });
    expect(JSON.stringify(audit)).not.toContain(refresh1.split('.')[1]);
  });

  it('AC-AUTH-04: reuse of a token from an earlier rotation logs the user out of ALL devices', async () => {
    const u = await createUser();
    const bystander = await createUser();
    const other = await loginAs(ctx, u); // another device (another family)
    const theirs = await loginAs(ctx, bystander);
    const login = await loginHttp(u);
    const t1 = cookieValue(login, 'tt_refresh');
    const t2 = cookieValue(await refresh(t1).expect(200), 'tt_refresh');
    const t3 = cookieValue(await refresh(t2).expect(200), 'tt_refresh');
    expect(await ctx.db.refreshTokenHistory.count()).toBe(2);
    await refresh(t1)
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('SESSION_REVOKED'));
    await refresh(t3).expect(401);
    await as(ctx.http, other.cookie)
      .get('/api/v1/me')
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('SESSION_REVOKED'));
    await refresh(other.refreshToken).expect(401);
    expect(await ctx.db.userSession.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
    expect(ctx.email.findByTemplate('security.token_reuse', u.email)).toHaveLength(1);
    const audit = await ctx.db.auditLog.findFirstOrThrow({
      where: { action: 'auth.refresh_reuse_detected' },
    });
    expect(audit.after).toMatchObject({ userId: u.id, revokedSessions: 2 });
    // Other users are untouched.
    await as(ctx.http, theirs.cookie).get('/api/v1/me').expect(200);
  });

  it('a token never issued for that session (forged raw part, known sid) is a plain 401 UNAUTHENTICATED: no revocation, no email', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    const other = await loginAs(ctx, u);
    const victim = await loginAs(ctx, u);
    // A spent token of ANOTHER session presented with this sid is not reuse of this one.
    await refresh(other.refreshToken).expect(200);
    const otherSpentRaw = other.refreshToken.split('.')[1]!;
    for (const forged of [
      `${s.sessionId}.${generateToken().raw}`,
      `${victim.sessionId}.${otherSpentRaw}`,
    ]) {
      const res = await refresh(forged)
        .expect(401)
        .expect(({ body }) => expect(body.code).toBe('UNAUTHENTICATED'));
      expect(setCookieLine(res, 'tt_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(setCookieLine(res, 'tt_access')).toMatch(/Expires=Thu, 01 Jan 1970/);
    }
    expect(await ctx.db.userSession.count({ where: { userId: u.id, revokedAt: null } })).toBe(3);
    await as(ctx.http, s.cookie).get('/api/v1/me').expect(200);
    await refresh(victim.refreshToken).expect(200);
    expect(ctx.email.findByTemplate('security.token_reuse', u.email)).toHaveLength(0);
    expect(await ctx.db.auditLog.count({ where: { action: 'auth.refresh_reuse_detected' } })).toBe(
      0,
    );
    expect(
      await ctx.db.refreshTokenHistory.findUnique({
        where: { tokenHash: hashToken(otherSpentRaw) },
      }),
    ).toMatchObject({ sessionId: other.sessionId });
  });

  it.each(['SUSPENDED', 'DELETING', 'DELETED'] as const)(
    'refresh for a %s user is 401 SESSION_REVOKED, clears the cookies and revokes the session',
    async (status) => {
      const u = await createUser();
      const s = await loginAs(ctx, u);
      await ctx.db.user.update({ where: { id: u.id }, data: { status } });
      const res = await refresh(s.refreshToken)
        .expect(401)
        .expect(({ body }) => expect(body.code).toBe('SESSION_REVOKED'));
      expect(setCookieLine(res, 'tt_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(
        (await ctx.db.userSession.findUniqueOrThrow({ where: { id: s.sessionId } })).revokedAt,
      ).toBeInstanceOf(Date);
      expect(ctx.email.sent).toEqual([]);
    },
  );

  it("two concurrent refreshes with the same token: one rotation, both get the winner's token, no reuse alarm", async () => {
    const u = await createUser();
    const login = await loginHttp(u);
    const t1 = cookieValue(login, 'tt_refresh');
    const sessions = ctx.app.get(SessionService);
    const meta = { ip: '127.0.0.1', userAgent: 'vitest' };
    const run = () =>
      RequestContext.run({ requestId: `race-${Math.random()}`, ...meta }, () =>
        sessions.rotate(t1, meta),
      );
    const [a, b] = await Promise.all([run(), run()]);
    expect(a).not.toBe('REUSE');
    expect(b).not.toBe('REUSE');
    if (a === 'REUSE' || b === 'REUSE') return;
    expect(a.refreshToken).toBe(b.refreshToken);
    expect(a.refreshToken).not.toBe(t1);
    expect(ctx.email.findByTemplate('security.token_reuse', u.email)).toHaveLength(0);
    // The shared token keeps working; the presented one is now spent for good.
    const next = await refresh(a.refreshToken).expect(200);
    await me(cookieValue(next, 'tt_access')).expect(200);
    await refresh(t1).expect(401);
  });

  it('parallel HTTP refreshes with the same cookie never trigger reuse detection', async () => {
    const u = await createUser();
    const t1 = cookieValue(await loginHttp(u), 'tt_refresh');
    const results = await Promise.all([refresh(t1), refresh(t1), refresh(t1)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const tokens = new Set(results.map((r) => cookieValue(r, 'tt_refresh')));
    expect(tokens.size).toBe(1);
    expect(ctx.email.findByTemplate('security.token_reuse', u.email)).toHaveLength(0);
    expect(await ctx.db.userSession.count({ where: { userId: u.id, revokedAt: null } })).toBe(1);
  });

  it('refresh keeps the remember-me persistence and the absolute 30-day expiry', async () => {
    const u = await createUser();
    const remembered = await loginHttp(u, { remember: true });
    const rotated = await refresh(cookieValue(remembered, 'tt_refresh')).expect(200);
    expect(setCookieLine(rotated, 'tt_refresh')).toMatch(/Max-Age=259\d{4};/);
    const plain = await loginHttp(u);
    const rotatedPlain = await refresh(cookieValue(plain, 'tt_refresh')).expect(200);
    expect(setCookieLine(rotatedPlain, 'tt_refresh')).not.toMatch(/Max-Age|Expires/);
    expect(setCookieLine(rotatedPlain, 'tt_access')).toMatch(/Max-Age=900;/);
  });

  it('refresh without a cookie or with a malformed/unknown token is 401 UNAUTHENTICATED and clears the cookies', async () => {
    await ctx.http
      .post('/api/v1/auth/refresh')
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('UNAUTHENTICATED'));
    for (const t of [
      'garbage',
      'not-a-uuid.abc',
      '0192f0c0-0000-7000-8000-000000000000.abc',
      `0192f0c0-0000-7000-8000-000000000000.${generateToken().raw}`,
    ]) {
      const res = await refresh(t)
        .expect(401)
        .expect(({ body }) => expect(body.code).toBe('UNAUTHENTICATED'));
      expect(setCookieLine(res, 'tt_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(setCookieLine(res, 'tt_access')).toMatch(/Expires=Thu, 01 Jan 1970/);
    }
    expect(ctx.email.sent).toEqual([]);
  });

  it('an expired session cannot be refreshed or used', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    await ctx.db.userSession.update({
      where: { id: s.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await refresh(s.refreshToken)
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('SESSION_REVOKED'));
    await me(s.accessToken)
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('SESSION_REVOKED'));
    expect(ctx.email.sent).toEqual([]);
  });

  it('logout revokes the current session only, clears the cookies, and a later refresh is a quiet 401', async () => {
    const u = await createUser();
    const [a, b] = [await loginAs(ctx, u), await loginAs(ctx, u)];
    const res = await as(ctx.http, a.cookie).post('/api/v1/auth/logout').expect(204);
    expect(setCookieLine(res, 'tt_access')).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(setCookieLine(res, 'tt_refresh')).toMatch(/Path=\/api\/v1\/auth/);
    expect(setCookieLine(res, 'tt_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
    await me(a.accessToken).expect(401);
    await me(b.accessToken).expect(200);
    await refresh(a.refreshToken)
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('SESSION_REVOKED'));
    // A deliberate logout is not a token theft.
    expect(ctx.email.findByTemplate('security.token_reuse', u.email)).toHaveLength(0);
  });

  it('logout with an expired access token falls back to the refresh cookie and revokes the server session', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    const expired = await new JwtService(env.JWT_SECRET, () => Date.now() - 20 * 60_000).signAccess(
      { sub: u.id, sid: s.sessionId },
    );
    const res = await ctx.http
      .post('/api/v1/auth/logout')
      .set('Cookie', `tt_access=${expired}; tt_refresh=${s.refreshToken}`)
      .expect(204);
    expect(setCookieLine(res, 'tt_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(
      (await ctx.db.userSession.findUniqueOrThrow({ where: { id: s.sessionId } })).revokedAt,
    ).toBeInstanceOf(Date);
    await refresh(s.refreshToken).expect(401);
    expect(ctx.email.sent).toEqual([]);
  });

  it('logout without credentials (or with junk) is still 204 and clears both cookies, revoking nothing', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    for (const cookie of [
      undefined,
      `tt_access=junk; tt_refresh=${s.sessionId}.${generateToken().raw}`,
    ]) {
      const req = ctx.http.post('/api/v1/auth/logout');
      if (cookie) req.set('Cookie', cookie);
      const res = await req.expect(204);
      expect(setCookieLine(res, 'tt_access')).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(setCookieLine(res, 'tt_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
    }
    await as(ctx.http, s.cookie).get('/api/v1/me').expect(200);
  });

  it('AC-AUTH-07: "Déconnecter partout" revokes 3 sessions immediately and lists them as revoked', async () => {
    const { db, http } = ctx;
    const u = await createUser();
    const s = await Promise.all([1, 2, 3].map(() => loginAs(ctx, u)));
    const list = await as(http, s[0]!.cookie).get('/api/v1/auth/sessions').expect(200);
    expect(list.body).toHaveLength(3);
    const del = await as(http, s[0]!.cookie).delete('/api/v1/auth/sessions').expect(204);
    expect(setCookieLine(del, 'tt_access')).toMatch(/Expires=Thu, 01 Jan 1970/);
    for (const x of s) {
      await as(http, x.cookie)
        .get('/api/v1/me')
        .expect(401)
        .expect(({ body }) => expect(body.code).toBe('SESSION_REVOKED'));
      await refresh(x.refreshToken).expect(401);
    }
    expect(await db.userSession.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
    expect(await db.userSession.count({ where: { userId: u.id, revokedAt: { not: null } } })).toBe(
      3,
    );
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'auth.sessions_revoked' },
    });
    expect(audit).toMatchObject({ actorUserId: u.id, entityType: 'User', entityId: u.id });
    expect(audit.after).toMatchObject({ scope: 'all', count: 3 });
    expect(ctx.email.findByTemplate('security.token_reuse', u.email)).toHaveLength(0);
  });

  it('GET /auth/sessions lists only my active sessions with device, ip and the current flag', async () => {
    const u = await createUser();
    const other = await createUser();
    const mine = await loginAs(ctx, u, {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      ip: '203.0.113.7',
    });
    const second = await loginAs(ctx, u);
    await loginAs(ctx, other);
    const revoked = await loginAs(ctx, u);
    await ctx.db.userSession.update({
      where: { id: revoked.sessionId },
      data: { revokedAt: new Date() },
    });

    const { body } = await as(ctx.http, mine.cookie).get('/api/v1/auth/sessions').expect(200);
    expect(body).toHaveLength(2);
    expect(body.map((x: { id: string }) => x.id).sort()).toEqual(
      [mine.sessionId, second.sessionId].sort(),
    );
    const current = body.find((x: { id: string }) => x.id === mine.sessionId);
    expect(current).toEqual({
      id: mine.sessionId,
      deviceLabel: 'Safari · macOS',
      ip: '203.0.113.7',
      createdAt: expect.any(String),
      lastSeenAt: expect.any(String),
      current: true,
    });
    expect(body.find((x: { id: string }) => x.id === second.sessionId).current).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/refreshTokenHash|familyId|userAgent/);
  });

  it("DELETE /auth/sessions/{id} revokes my session; another user's is 404 and stays active", async () => {
    const u = await createUser();
    const other = await createUser();
    const a = await loginAs(ctx, u);
    const b = await loginAs(ctx, u);
    const theirs = await loginAs(ctx, other);

    await as(ctx.http, a.cookie)
      .delete(`/api/v1/auth/sessions/${theirs.sessionId}`)
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('NOT_FOUND'));
    await as(ctx.http, theirs.cookie).get('/api/v1/me').expect(200);
    await as(ctx.http, a.cookie).delete('/api/v1/auth/sessions/not-a-uuid').expect(404);

    const res = await as(ctx.http, a.cookie)
      .delete(`/api/v1/auth/sessions/${b.sessionId}`)
      .expect(204);
    expect(setCookieLine(res, 'tt_access')).toBeUndefined(); // not the current session
    await as(ctx.http, b.cookie).get('/api/v1/me').expect(401);
    await as(ctx.http, a.cookie).get('/api/v1/me').expect(200);
    const audit = await ctx.db.auditLog.findFirstOrThrow({
      where: { action: 'auth.sessions_revoked' },
    });
    expect(audit.after).toMatchObject({ scope: 'one', sessionId: b.sessionId });

    // Revoking an already revoked session: 204, nothing audited.
    await as(ctx.http, a.cookie).delete(`/api/v1/auth/sessions/${b.sessionId}`).expect(204);
    expect(await ctx.db.auditLog.count({ where: { action: 'auth.sessions_revoked' } })).toBe(1);

    // Revoking the current session also clears its cookies.
    const self = await as(ctx.http, a.cookie)
      .delete(`/api/v1/auth/sessions/${a.sessionId}`)
      .expect(204);
    expect(setCookieLine(self, 'tt_access')).toMatch(/Expires=Thu, 01 Jan 1970/);
    await as(ctx.http, a.cookie).get('/api/v1/me').expect(401);
  });

  it('accepts Authorization: Bearer as well as the cookie', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    const res = await ctx.http
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${s.accessToken}`)
      .expect(200);
    expect(res.body.user).toMatchObject({ id: u.id, email: u.email });
  });

  it('a 2fa-typed token is rejected as access token (401)', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    const challenge = await ctx.app
      .get(JwtService)
      .signChallenge({ sub: u.id, jti: s.sessionId, cv: 0 });
    await me(challenge)
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('UNAUTHENTICATED'));
    await ctx.http.get('/api/v1/me').set('Authorization', `Bearer ${challenge}`).expect(401);
  });

  it('rejects missing, tampered, foreign-key, unsigned and expired access tokens with 401 UNAUTHENTICATED', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    const key = new TextEncoder().encode(env.JWT_SECRET);
    const claims = { typ: 'access', sid: s.sessionId };
    const forged = [
      // payload swapped, signature kept
      s.accessToken.replace(
        /\.[^.]+\./,
        `.${Buffer.from(JSON.stringify({ ...claims, sub: 'x' })).toString('base64url')}.`,
      ),
      await new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(u.id)
        .setExpirationTime('15m')
        .sign(new TextEncoder().encode('another secret that is long enough!!')),
      `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ ...claims, sub: u.id })).toString('base64url')}.`,
      await new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS512' })
        .setSubject(u.id)
        .setExpirationTime('15m')
        .sign(key),
      await new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(u.id)
        .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
        .sign(key),
    ];
    await ctx.http
      .get('/api/v1/me')
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('UNAUTHENTICATED'));
    for (const token of forged) {
      await me(token)
        .expect(401)
        .expect(({ body }) => expect(body.code).toBe('UNAUTHENTICATED'));
    }
  });

  it("an access token is bound to its session's user", async () => {
    const u = await createUser();
    const other = await createUser();
    const s = await loginAs(ctx, u);
    const token = await ctx.app.get(JwtService).signAccess({ sub: other.id, sid: s.sessionId });
    await me(token).expect(401);
  });

  it('never writes access or refresh tokens to the logs', async () => {
    const u = await createUser();
    const login = await loginHttp(u);
    const t1 = cookieValue(login, 'tt_refresh');
    const r2 = await refresh(t1).expect(200);
    await refresh(t1).expect(401);
    const logs = JSON.stringify(ctx.logs.lines());
    for (const secret of [
      cookieValue(login, 'tt_access'),
      t1,
      t1.split('.')[1]!,
      cookieValue(r2, 'tt_refresh').split('.')[1]!,
      cookieValue(r2, 'tt_access'),
    ]) {
      expect(logs).not.toContain(secret);
    }
  });
});
