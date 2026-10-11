import {
  InMemoryEmailProvider,
  extractFirstLink,
  type EmailMessage,
  type EmailTemplateKey,
} from '@tt/providers';
import type Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateToken } from '../../src/auth/crypto/tokens';
import { verifyPassword } from '../../src/auth/crypto/password';
import { PasswordResetService } from '../../src/auth/password-reset.service';
import { EMAIL_PROVIDER } from '../../src/providers/providers.module';
import { REDIS } from '../../src/redis/redis.module';
import { createTestApp, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createUser } from '../helpers/factories';

const NEW_PASSWORD = 'nouveau mot de passe long';
const FORGOT = '/api/v1/auth/password/forgot';
const RESET = '/api/v1/auth/password/reset';

/** Forgot-password throttle keys survive `ctx.reset()` (Redis is not flushed): clear them. */
async function clearForgotThrottle(ctx: TestContext): Promise<void> {
  const redis = ctx.app.get<Redis>(REDIS);
  const keys = await redis.keys('auth:password-forgot:*');
  if (keys.length > 0) await redis.del(...keys);
}

/** Waits for the forgot-password work done after the response (token, audit, email). */
const drained = (ctx: TestContext) => ctx.app.get(PasswordResetService).drain();

/** The raw token of the most recent reset email to `to` (the email is sent off the request path). */
async function resetTokenFor(ctx: TestContext, to: string, count = 1): Promise<string> {
  await drained(ctx);
  expect(ctx.email.findByTemplate('auth.password_reset', to)).toHaveLength(count);
  const mail = ctx.email.findByTemplate('auth.password_reset', to).at(-1)!;
  return new URL(extractFirstLink(mail.html, '/reset-password')!).searchParams.get('token')!;
}

describe('password reset and change (AC-AUTH-06)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    await clearForgotThrottle(ctx);
  });

  describe('POST /auth/password/forgot', () => {
    it('AC-AUTH-06: forgot is 202 for unknown and known emails alike; only known gets an email', async () => {
      const { http, email, db } = ctx;
      const unknown = await http.post(FORGOT).send({ email: 'nobody@example.com' }).expect(202);
      expect(unknown.body).toEqual({});
      await drained(ctx);
      expect(email.sent).toHaveLength(0);
      expect(await db.verificationToken.count()).toBe(0);
      const u = await createUser();
      const known = await http
        .post(FORGOT)
        .send({ email: `  ${u.email.toUpperCase()} ` })
        .expect(202);
      expect(known.body).toEqual(unknown.body);
      expect(Object.keys(known.headers).sort()).toEqual(Object.keys(unknown.headers).sort());

      const token = await resetTokenFor(ctx, u.email);
      expect(email.sent).toHaveLength(1);
      const mail = email.findByTemplate('auth.password_reset', u.email)[0]!;
      expect(extractFirstLink(mail.html, '/fr/reset-password?token=')).toBeTruthy();
      expect(mail.params.firstName).toBe(u.firstName);

      const stored = await db.verificationToken.findMany({ where: { userId: u.id } });
      expect(stored).toHaveLength(1);
      expect(stored[0]!.purpose).toBe('PASSWORD_RESET');
      expect(stored[0]!.tokenHash).not.toBe(token);
      const ttl = stored[0]!.expiresAt.getTime() - stored[0]!.createdAt.getTime();
      expect(ttl).toBeGreaterThan(59 * 60_000);
      expect(ttl).toBeLessThanOrEqual(60 * 60_000 + 5_000);

      const audit = await db.auditLog.findMany();
      expect(audit).toHaveLength(1); // nothing for the unknown email
      expect(audit[0]).toMatchObject({ entityId: u.id, actorRole: 'ANONYMOUS' });
      expect(JSON.stringify(audit)).not.toContain(token);
    });

    it('a new request invalidates the previous link', async () => {
      const u = await createUser();
      await ctx.http.post(FORGOT).send({ email: u.email }).expect(202);
      const first = await resetTokenFor(ctx, u.email, 1);
      await ctx.http.post(FORGOT).send({ email: u.email }).expect(202);
      const second = await resetTokenFor(ctx, u.email, 2);
      expect(second).not.toBe(first);
      const res = await ctx.http
        .post(RESET)
        .send({ token: first, newPassword: NEW_PASSWORD })
        .expect(410);
      expect(res.body.code).toBe('TOKEN_INVALID');
      await ctx.http.post(RESET).send({ token: second, newPassword: NEW_PASSWORD }).expect(200);
    });

    it('is throttled to 3 per hour per email, silently (still 202, no more emails)', async () => {
      const u = await createUser();
      for (let i = 1; i <= 3; i += 1) {
        await ctx.http.post(FORGOT).send({ email: u.email }).expect(202);
        await resetTokenFor(ctx, u.email, i);
      }
      const res = await ctx.http.post(FORGOT).send({ email: u.email.toUpperCase() }).expect(202);
      expect(res.body).toEqual({});
      // Unknown emails are counted the same way (same answer whether or not the account exists).
      for (let i = 0; i < 4; i += 1) {
        await ctx.http.post(FORGOT).send({ email: 'nobody@example.com' }).expect(202);
      }
      await drained(ctx);
      expect(ctx.email.findByTemplate('auth.password_reset', u.email)).toHaveLength(3);
      expect(ctx.email.sent).toHaveLength(3);
    });

    it('sends nothing to a deleted account', async () => {
      const u = await createUser({ status: 'DELETED' });
      await ctx.http.post(FORGOT).send({ email: u.email }).expect(202);
      await drained(ctx);
      expect(ctx.email.sent).toHaveLength(0);
      expect(await ctx.db.verificationToken.count()).toBe(0);
    });

    it('rejects a malformed email with 422 VALIDATION_FAILED', async () => {
      const res = await ctx.http.post(FORGOT).send({ email: 'not-an-email' }).expect(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('POST /auth/password/reset', () => {
    it('reset sets the password, revokes every session, and the link is single-use and expires after 1 h', async () => {
      const { http, db, email } = ctx;
      const u = await createUser();
      const s = await loginAs(ctx, u);
      const s2 = await loginAs(ctx, u, { userAgent: 'other device' });
      await http.post(FORGOT).send({ email: u.email }).expect(202);
      const token = await resetTokenFor(ctx, u.email);

      const ok = await http.post(RESET).send({ token, newPassword: NEW_PASSWORD }).expect(200);
      expect(ok.body).toEqual({ ok: true });
      await as(http, s.cookie).get('/api/v1/me').expect(401);
      await as(http, s2.cookie).get('/api/v1/me').expect(401);
      expect(await db.userSession.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);

      await http.post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(401);
      await http.post('/api/v1/auth/login').send({ email: u.email, password: NEW_PASSWORD }).expect(200);
      const again = await http
        .post(RESET)
        .send({ token, newPassword: 'encore un autre mot de passe' })
        .expect(410);
      expect(again.body.code).toBe('TOKEN_INVALID');
      const user = await db.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(await verifyPassword(user.passwordHash!, NEW_PASSWORD)).toBe(true);

      expect(email.findByTemplate('security.password_changed', u.email)).toHaveLength(1);
      const audit = await db.auditLog.findMany({ where: { action: 'auth.password_reset' } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ entityId: u.id, actorUserId: u.id });
      expect(audit[0]!.after).toMatchObject({ revokedSessions: 2 });
      const all = JSON.stringify(await db.auditLog.findMany());
      expect(all).not.toContain(token);
      expect(all).not.toContain(NEW_PASSWORD);
      expect(all).not.toMatch(/argon2/);
    });

    it('AC-AUTH-06: an expired link is 410 TOKEN_INVALID', async () => {
      const u = await createUser();
      await ctx.http.post(FORGOT).send({ email: u.email }).expect(202);
      const token = await resetTokenFor(ctx, u.email);
      await ctx.db.verificationToken.updateMany({
        where: { userId: u.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await ctx.http.post(RESET).send({ token, newPassword: NEW_PASSWORD }).expect(410);
      expect(res.body.code).toBe('TOKEN_INVALID');
      const user = await ctx.db.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(await verifyPassword(user.passwordHash!, u.password)).toBe(true);
    });

    it('unknown tokens and tokens of another purpose are 410 TOKEN_INVALID, audited without the token', async () => {
      const u = await createUser();
      const { raw, hash } = generateToken();
      await ctx.db.verificationToken.create({
        data: {
          userId: u.id,
          purpose: 'EMAIL_VERIFY',
          tokenHash: hash,
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      for (const token of [raw, 'not-a-real-token']) {
        const res = await ctx.http.post(RESET).send({ token, newPassword: NEW_PASSWORD }).expect(410);
        expect(res.body.code).toBe('TOKEN_INVALID');
      }
      const failed = await ctx.db.auditLog.findMany({
        where: { action: 'auth.password_reset_failed' },
      });
      expect(failed).toHaveLength(2);
      expect(failed[0]).toMatchObject({ actorRole: 'ANONYMOUS', entityId: null });
      expect(JSON.stringify(failed)).not.toContain(raw);
      expect(JSON.stringify(failed)).not.toContain(NEW_PASSWORD);
    });

    it('a weak password is refused with 422 and does not consume the link', async () => {
      const u = await createUser();
      await ctx.http.post(FORGOT).send({ email: u.email }).expect(202);
      const token = await resetTokenFor(ctx, u.email);
      const short = await ctx.http.post(RESET).send({ token, newPassword: 'court' }).expect(422);
      expect(short.body.code).toBe('PASSWORD_TOO_SHORT');
      const common = await ctx.http
        .post(RESET)
        .send({ token, newPassword: 'password1234' })
        .expect(422);
      expect(common.body.code).toBe('PASSWORD_TOO_COMMON');
      const tooLong = await ctx.http
        .post(RESET)
        .send({ token, newPassword: 'a'.repeat(257) })
        .expect(422);
      expect(tooLong.body.code).toBe('VALIDATION_FAILED');
      await ctx.http.post(RESET).send({ token, newPassword: NEW_PASSWORD }).expect(200);
    });

    it('a link used concurrently resets exactly once', async () => {
      const u = await createUser();
      await ctx.http.post(FORGOT).send({ email: u.email }).expect(202);
      const token = await resetTokenFor(ctx, u.email);
      const results = await Promise.all(
        [1, 2, 3].map((i) =>
          ctx.http.post(RESET).send({ token, newPassword: `${NEW_PASSWORD} ${i}` }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 410, 410]);
      expect(ctx.email.findByTemplate('security.password_changed', u.email)).toHaveLength(1);
    });

    it('never writes the token or the passwords to the logs', async () => {
      const u = await createUser();
      await ctx.http.post(FORGOT).send({ email: u.email }).expect(202);
      const token = await resetTokenFor(ctx, u.email);
      await ctx.http.post(RESET).send({ token, newPassword: NEW_PASSWORD }).expect(200);
      const logs = JSON.stringify(ctx.logs.lines());
      expect(logs).not.toContain(token);
      expect(logs).not.toContain(NEW_PASSWORD);
    });
  });

  describe('PATCH /me/password', () => {
    const CHANGE = '/api/v1/me/password';

    it('PATCH /me/password keeps the current session and kills the others', async () => {
      const { http, db, email } = ctx;
      const u = await createUser();
      const current = await loginAs(ctx, u);
      const other = await loginAs(ctx, u, { userAgent: 'other device' });
      const res = await as(http, current.cookie)
        .patch(CHANGE)
        .send({ currentPassword: u.password, newPassword: NEW_PASSWORD })
        .expect(200);
      expect(res.body).toEqual({ ok: true });
      await as(http, current.cookie).get('/api/v1/me').expect(200);
      await as(http, other.cookie).get('/api/v1/me').expect(401);
      await http.post('/api/v1/auth/login').send({ email: u.email, password: NEW_PASSWORD }).expect(200);

      expect(email.findByTemplate('security.password_changed', u.email)).toHaveLength(1);
      const audit = await db.auditLog.findMany({ where: { action: 'auth.password_changed' } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ entityId: u.id, actorUserId: u.id, actorRole: 'USER' });
      expect(audit[0]!.after).toMatchObject({ revokedSessions: 1 });
      const all = JSON.stringify(await db.auditLog.findMany());
      expect(all).not.toContain(NEW_PASSWORD);
      expect(all).not.toContain(u.password);
    });

    it('a wrong current password is 401 INVALID_CREDENTIALS, audited without secrets, nothing changes', async () => {
      const u = await createUser();
      const current = await loginAs(ctx, u);
      const other = await loginAs(ctx, u, { userAgent: 'other device' });
      const res = await as(ctx.http, current.cookie)
        .patch(CHANGE)
        .send({ currentPassword: 'pas le bon mot de passe', newPassword: NEW_PASSWORD })
        .expect(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
      await as(ctx.http, other.cookie).get('/api/v1/me').expect(200);
      const user = await ctx.db.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(await verifyPassword(user.passwordHash!, u.password)).toBe(true);
      expect(ctx.email.sent).toHaveLength(0);
      const failed = await ctx.db.auditLog.findMany({
        where: { action: 'auth.password_change_failed' },
      });
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({ entityId: u.id, actorUserId: u.id });
      expect(JSON.stringify(failed)).not.toMatch(/pas le bon|nouveau mot de passe/);
    });

    it('applies the password policy and the 256-character cap', async () => {
      const u = await createUser();
      const s = await loginAs(ctx, u);
      const weak = await as(ctx.http, s.cookie)
        .patch(CHANGE)
        .send({ currentPassword: u.password, newPassword: 'trop court' })
        .expect(422);
      expect(weak.body.code).toBe('PASSWORD_TOO_SHORT');
      ctx.pwned.add(NEW_PASSWORD);
      const pwned = await as(ctx.http, s.cookie)
        .patch(CHANGE)
        .send({ currentPassword: u.password, newPassword: NEW_PASSWORD })
        .expect(422);
      expect(pwned.body.code).toBe('PASSWORD_COMPROMISED');
      for (const body of [
        { currentPassword: u.password, newPassword: 'a'.repeat(257) },
        { currentPassword: 'a'.repeat(257), newPassword: 'un mot de passe solide' },
      ]) {
        const res = await as(ctx.http, s.cookie).patch(CHANGE).send(body).expect(422);
        expect(res.body.code).toBe('VALIDATION_FAILED');
      }
    });

    it('requires authentication', async () => {
      const res = await ctx.http
        .patch(CHANGE)
        .send({ currentPassword: 'x', newPassword: NEW_PASSWORD })
        .expect(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('a pending reset link stops working once the password is changed', async () => {
      const u = await createUser();
      const s = await loginAs(ctx, u);
      await ctx.http.post(FORGOT).send({ email: u.email }).expect(202);
      const token = await resetTokenFor(ctx, u.email);
      await as(ctx.http, s.cookie)
        .patch(CHANGE)
        .send({ currentPassword: u.password, newPassword: NEW_PASSWORD })
        .expect(200);
      await ctx.http
        .post(RESET)
        .send({ token, newPassword: 'encore un autre mot de passe' })
        .expect(410);
    });
  });
});

describe('forgot password timing: email delivery is off the request path', () => {
  let ctx: TestContext;
  const DELAY_MS = 1500;

  class SlowEmailProvider extends InMemoryEmailProvider {
    override async send<K extends EmailTemplateKey>(msg: EmailMessage<K>) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      return super.send(msg);
    }
  }

  beforeAll(async () => {
    const slow = new SlowEmailProvider();
    ctx = await createTestApp({
      overrides: (b) => b.overrideProvider(EMAIL_PROVIDER).useValue(slow),
    });
    // `ctx.email` is the default fake; read the slow one directly.
    (ctx as { email: InMemoryEmailProvider }).email = slow;
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    await clearForgotThrottle(ctx);
  });

  it('a known email answers as fast as an unknown one (no wait on the mail provider)', async () => {
    const u = await createUser();
    const started = Date.now();
    await ctx.http.post(FORGOT).send({ email: u.email }).expect(202);
    expect(Date.now() - started).toBeLessThan(DELAY_MS);
    expect(ctx.email.sent).toHaveLength(0);
    await drained(ctx);
    expect(ctx.email.findByTemplate('auth.password_reset', u.email)).toHaveLength(1);
  });
});
