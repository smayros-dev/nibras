import { authenticator } from 'otplib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs, setCookies } from '../helpers/auth';
import { createOrganization, createPersonalWorkspace, createUser } from '../helpers/factories';

const SECRET = authenticator.generateSecret();

/** A 6-digit code that is NOT valid for `secret` right now (nor in the ±1 step window). */
function wrongCode(secret: string): string {
  const step = 30_000;
  const now = Date.now();
  const valid = new Set(
    [-1, 0, 1].map((d) => authenticator.clone({ epoch: now + d * step }).generate(secret)),
  );
  for (let n = 0; ; n++) {
    const candidate = String(n).padStart(6, '0');
    if (!valid.has(candidate)) return candidate;
  }
}

describe('2FA: TOTP setup, login challenge, recovery codes, mandatory policy', () => {
  let ctx: TestContext;
  let http: TestAgent;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = ctx.http;
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  const login = (u: { email: string; password: string }) =>
    http.post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(200);

  /** Enables TOTP for `u` through the API; returns the seed and the recovery codes. */
  async function enable(cookie: string): Promise<{ secret: string; recoveryCodes: string[] }> {
    const { secret } = (await as(http, cookie).post('/api/v1/auth/2fa/setup').expect(200)).body;
    const { recoveryCodes } = (
      await as(http, cookie)
        .post('/api/v1/auth/2fa/verify')
        .send({ otpCode: authenticator.generate(secret) })
        .expect(200)
    ).body;
    return { secret, recoveryCodes };
  }

  it('setup → verify enables TOTP, returns 10 recovery codes once, then login requires a challenge', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    const setup = await as(http, s.cookie).post('/api/v1/auth/2fa/setup').expect(200);
    const { secret, otpauthUrl } = setup.body;
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(decodeURIComponent(otpauthUrl)).toContain(u.email);
    expect(decodeURIComponent(otpauthUrl)).toContain('issuer=Plateforme cours');
    // Pending: the seed is stored sealed, 2FA not enabled yet.
    const pending = await ctx.db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(pending.totpEnabledAt).toBeNull();
    expect(pending.totpSecretEnc).toMatch(/^v1\./);
    expect(pending.totpSecretEnc).not.toContain(secret);

    // A wrong code does not confirm.
    await as(http, s.cookie)
      .post('/api/v1/auth/2fa/verify')
      .send({ otpCode: wrongCode(secret) })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('TWO_FACTOR_INVALID'));

    const { recoveryCodes } = (
      await as(http, s.cookie)
        .post('/api/v1/auth/2fa/verify')
        .send({ otpCode: authenticator.generate(secret) })
        .expect(200)
    ).body;
    expect(recoveryCodes).toHaveLength(10);
    expect(recoveryCodes[0]).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(new Set(recoveryCodes).size).toBe(10);

    const enabled = await ctx.db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(enabled.totpEnabledAt).toBeInstanceOf(Date);
    expect(enabled.recoveryCodesHash).toHaveLength(10);
    expect(enabled.recoveryCodesHash.join()).not.toContain(recoveryCodes[0]);
    expect(enabled.recoveryCodesHash[0]).toMatch(/^\$argon2id\$/);
    expect(ctx.email.findByTemplate('security.2fa_enabled', u.email)).toHaveLength(1);
    const audit = await ctx.db.auditLog.findFirstOrThrow({ where: { action: 'auth.2fa_enabled' } });
    expect(audit.entityId).toBe(u.id);
    expect(JSON.stringify(audit)).not.toMatch(new RegExp(`${secret}|argon2|${recoveryCodes[0]}`));

    // Already enabled: setup again is refused; codes are never shown again.
    await as(http, s.cookie)
      .post('/api/v1/auth/2fa/setup')
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('TWO_FACTOR_ALREADY_ENABLED'));
    await as(http, s.cookie)
      .post('/api/v1/auth/2fa/verify')
      .send({ otpCode: authenticator.generate(secret) })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('TWO_FACTOR_ALREADY_ENABLED'));

    const first = await login(u);
    expect(first.body.status).toBe('TWO_FACTOR_REQUIRED');
    expect(typeof first.body.challengeToken).toBe('string');
    expect(first.headers['set-cookie']).toBeUndefined();
    expect(await ctx.db.userSession.count({ where: { userId: u.id } })).toBe(1); // loginAs only

    const ok = await http
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken: first.body.challengeToken, otpCode: authenticator.generate(secret) })
      .expect(200);
    expect(setCookies(ok).join()).toMatch(/tt_access=/);
    expect(ok.body.status).toBe('OK');
    expect(ok.body.user).toMatchObject({ id: u.id, twoFactor: { enabled: true, required: false } });
    expect(await ctx.db.userSession.count({ where: { userId: u.id } })).toBe(2);
    expect(await ctx.db.auditLog.count({ where: { action: 'auth.login', entityId: u.id } })).toBe(
      1,
    );
  });

  it('challenge token cannot be used as access token, cannot be replayed, and recovery codes are single-use', async () => {
    const u = await createUser();
    const { secret, recoveryCodes } = await enable((await loginAs(ctx, u)).cookie);

    const { challengeToken } = (await login(u)).body;
    await http.get('/api/v1/me').set('Cookie', `tt_access=${challengeToken}`).expect(401);
    await http.get('/api/v1/me').set('Authorization', `Bearer ${challengeToken}`).expect(401);

    // Wrong code: 401 TWO_FACTOR_INVALID, audited as a failed login; the challenge stays usable.
    await http
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken, otpCode: wrongCode(secret) })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('TWO_FACTOR_INVALID'));
    const failed = await ctx.db.auditLog.findFirstOrThrow({
      where: { action: 'auth.login_failed', entityId: u.id },
    });
    expect(failed.after).toMatchObject({ reason: 'two_factor_invalid' });

    await http
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken, otpCode: authenticator.generate(secret) })
      .expect(200);
    // Replay of a consumed challenge.
    await http
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken, otpCode: authenticator.generate(secret) })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('TOKEN_INVALID'));
    await http
      .post('/api/v1/auth/2fa/recovery')
      .send({ challengeToken, recoveryCode: recoveryCodes[1] })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('TOKEN_INVALID'));
    // Garbage and access tokens are not challenges.
    await http
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken: 'not-a-jwt', otpCode: authenticator.generate(secret) })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('TOKEN_INVALID'));
    const s = await loginAs(ctx, u);
    await http
      .post('/api/v1/auth/2fa/recovery')
      .send({ challengeToken: s.accessToken, recoveryCode: recoveryCodes[1] })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('TOKEN_INVALID'));

    // Recovery code (case-insensitive, surrounding spaces ignored), then single-use.
    const r1 = await http
      .post('/api/v1/auth/2fa/recovery')
      .send({
        challengeToken: (await login(u)).body.challengeToken,
        recoveryCode: ` ${recoveryCodes[0]!.toUpperCase()} `,
        remember: true,
      })
      .expect(200);
    expect(r1.body.status).toBe('OK');
    expect(setCookies(r1).join()).toMatch(/tt_refresh=.*Expires=/);
    const used = ctx.email.findByTemplate('security.recovery_code_used', u.email);
    expect(used).toHaveLength(1);
    expect(used[0]!.params).toMatchObject({ remaining: 9 });
    expect(
      (await ctx.db.user.findUniqueOrThrow({ where: { id: u.id } })).recoveryCodesHash,
    ).toHaveLength(9);
    const usedAudit = await ctx.db.auditLog.findFirstOrThrow({
      where: { action: 'auth.recovery_code_used' },
    });
    expect(usedAudit.after).toEqual({ remaining: 9 });

    await http
      .post('/api/v1/auth/2fa/recovery')
      .send({
        challengeToken: (await login(u)).body.challengeToken,
        recoveryCode: recoveryCodes[0],
      })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('TWO_FACTOR_INVALID'));
    await http
      .post('/api/v1/auth/2fa/recovery')
      .send({ challengeToken: (await login(u)).body.challengeToken, recoveryCode: 'aaaaa-aaaaa' })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('TWO_FACTOR_INVALID'));
    // `code` is never a request field.
    await http
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken: (await login(u)).body.challengeToken, code: '123456' })
      .expect(422);
  });

  it('wrong 2FA codes count as login failures (backoff after 5)', async () => {
    const u = await createUser({ totpSecret: SECRET });
    const { challengeToken } = (await login(u)).body;
    for (let i = 0; i < 5; i++) {
      await http
        .post('/api/v1/auth/2fa/verify')
        .send({ challengeToken, otpCode: wrongCode(SECRET) })
        .expect(401);
    }
    await http
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken, otpCode: authenticator.generate(SECRET) })
      .expect(429)
      .expect(({ body }) => expect(body.code).toBe('RATE_LIMITED'));
  });

  it('a challenge dies with a password change made after it was issued', async () => {
    const u = await createUser({ totpSecret: SECRET });
    const { challengeToken } = (await login(u)).body;
    await ctx.db.user.update({
      where: { id: u.id },
      data: { credentialsVersion: { increment: 1 } },
    });
    await http
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken, otpCode: authenticator.generate(SECRET) })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('TOKEN_INVALID'));
    expect(await ctx.db.userSession.count({ where: { userId: u.id } })).toBe(0);
  });

  it('AC-AUTH-05: an ADMIN of an organisation without 2FA is blocked everywhere except setup until TOTP is confirmed', async () => {
    const owner = await createUser({ totpSecret: SECRET });
    const admin = await createUser();
    await createOrganization({ owner, admins: [admin] });
    const s = await loginAs(ctx, admin);
    // GET /workspaces/{wid} arrives with Task 14; /auth/sessions is a non-exempt route.
    await as(http, s.cookie)
      .get('/api/v1/auth/sessions')
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('TWO_FACTOR_SETUP_REQUIRED'));
    await as(http, s.cookie)
      .get('/api/v1/me')
      .expect(200)
      .expect(({ body }) =>
        expect(body.twoFactor).toEqual({ enabled: false, required: true }),
      );
    const { secret } = (await as(http, s.cookie).post('/api/v1/auth/2fa/setup').expect(200)).body;
    // Still blocked while setup is pending.
    await as(http, s.cookie).get('/api/v1/auth/sessions').expect(403);
    await as(http, s.cookie)
      .post('/api/v1/auth/2fa/verify')
      .send({ otpCode: authenticator.generate(secret) })
      .expect(200);
    await as(http, s.cookie).get('/api/v1/auth/sessions').expect(200);
    await as(http, s.cookie)
      .get('/api/v1/me')
      .expect(200)
      .expect(({ body }) => expect(body.twoFactor).toEqual({ enabled: true, required: true }));
    await as(http, s.cookie)
      .post('/api/v1/auth/2fa/disable')
      .send({ otpCode: authenticator.generate(secret) })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('TWO_FACTOR_MANDATORY'));
    expect(
      (await ctx.db.user.findUniqueOrThrow({ where: { id: admin.id } })).totpEnabledAt,
    ).toBeInstanceOf(Date);
  });

  it('a SUPER_ADMIN without 2FA is gated too', async () => {
    const root = await createUser({ platformRole: 'SUPER_ADMIN' });
    const s = await loginAs(ctx, root);
    await as(http, s.cookie)
      .get('/api/v1/auth/sessions')
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('TWO_FACTOR_SETUP_REQUIRED'));
    // Logout stays reachable.
    await as(http, s.cookie).post('/api/v1/auth/logout').expect(204);
  });

  it('a personal-workspace teacher may enable and later disable 2FA', async () => {
    const u = await createUser();
    await createPersonalWorkspace(u);
    const s = await loginAs(ctx, u);
    await as(http, s.cookie).get('/api/v1/auth/sessions').expect(200);
    await as(http, s.cookie)
      .get('/api/v1/me')
      .expect(200)
      .expect(({ body }) =>
        expect(body.twoFactor).toEqual({ enabled: false, required: false }),
      );
    // Nothing to disable yet.
    await as(http, s.cookie)
      .post('/api/v1/auth/2fa/disable')
      .send({ otpCode: '123456' })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('TWO_FACTOR_INVALID'));

    const { secret } = await enable(s.cookie);
    await as(http, s.cookie)
      .get('/api/v1/me')
      .expect(({ body }) =>
        expect(body.twoFactor).toEqual({ enabled: true, required: false }),
      );
    await as(http, s.cookie)
      .post('/api/v1/auth/2fa/disable')
      .send({ otpCode: wrongCode(secret) })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('TWO_FACTOR_INVALID'));
    await as(http, s.cookie)
      .post('/api/v1/auth/2fa/disable')
      .send({ otpCode: authenticator.generate(secret) })
      .expect(204);

    const after = await ctx.db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after).toMatchObject({
      totpEnabledAt: null,
      totpSecretEnc: null,
      recoveryCodesHash: [],
    });
    expect(ctx.email.findByTemplate('security.2fa_disabled', u.email)).toHaveLength(1);
    expect(await ctx.db.auditLog.count({ where: { action: 'auth.2fa_disabled' } })).toBe(1);
    const res = await login(u);
    expect(res.body.status).toBe('OK');
  });
});
