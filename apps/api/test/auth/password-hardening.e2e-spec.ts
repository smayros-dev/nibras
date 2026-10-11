import { systemPrisma } from '@tt/db';
import {
  InMemoryEmailProvider,
  extractFirstLink,
  type EmailMessage,
  type EmailTemplateKey,
} from '@tt/providers';
import type Redis from 'ioredis';
import type { PinoLogger } from 'nestjs-pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyPassword } from '../../src/auth/crypto/password';
import { PasswordPolicy } from '../../src/auth/crypto/password-policy';
import { hashToken } from '../../src/auth/crypto/tokens';
import { PasswordResetService } from '../../src/auth/password-reset.service';
import { SessionService } from '../../src/auth/session.service';
import { REFRESH_COOKIE } from '../../src/auth/cookies';
import { EMAIL_PROVIDER } from '../../src/providers/providers.module';
import { REDIS } from '../../src/redis/redis.module';
import { createTestApp, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createUser } from '../helpers/factories';

const NEW_PASSWORD = 'nouveau mot de passe long';
const FORGOT = '/api/v1/auth/password/forgot';
const RESET = '/api/v1/auth/password/reset';
const CHANGE = '/api/v1/me/password';
const EMAIL_CHANGE = '/api/v1/me/email-change';
const CONFIRM = '/api/v1/auth/email-change/confirm';

const forgotKey = (email: string) => `auth:password-forgot:${hashToken(email)}`;

async function clearForgotThrottle(ctx: TestContext): Promise<void> {
  const redis = ctx.app.get<Redis>(REDIS);
  const keys = await redis.keys('auth:password-forgot:*');
  if (keys.length > 0) await redis.del(...keys);
}

async function resetToken(ctx: TestContext, to: string): Promise<string> {
  await ctx.app.get(PasswordResetService).drain();
  const mail = ctx.email.findByTemplate('auth.password_reset', to).at(-1)!;
  return new URL(extractFirstLink(mail.html, '/reset-password')!).searchParams.get('token')!;
}

function confirmToken(ctx: TestContext, to: string): string {
  const mail = ctx.email.findByTemplate('auth.email_change_confirm', to).at(-1)!;
  return new URL(extractFirstLink(mail.html, '/confirm-email')!).searchParams.get('token')!;
}

describe('password and email change hardening', () => {
  let ctx: TestContext;
  let redis: Redis;

  beforeAll(async () => {
    ctx = await createTestApp();
    redis = ctx.app.get<Redis>(REDIS);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    await clearForgotThrottle(ctx);
  });

  describe('forgot-password throttle window', () => {
    it('a key left without a TTL gets one on the next request', async () => {
      const key = forgotKey('legacy@example.com');
      await redis.set(key, '1'); // no TTL, as an older non-atomic writer could leave it
      expect(await redis.ttl(key)).toBe(-1);
      await ctx.http.post(FORGOT).send({ email: 'legacy@example.com' }).expect(202);
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(3600);
      expect(await redis.get(key)).toBe('2');
    });

    it('a burst, including across the expiry of the window, never leaves a key without a TTL', async () => {
      const key = forgotKey('burst@example.com');
      let ip = 0;
      // A fresh client ip per burst: the anonymous limit is 60 requests/min per ip.
      const burst = () => {
        ip += 1;
        return Promise.all(
          Array.from({ length: 10 }, () =>
            ctx.http
              .post(FORGOT)
              .set('X-Forwarded-For', `10.8.0.${ip}`)
              .send({ email: 'burst@example.com' }),
          ),
        );
      };
      expect((await burst()).every((r) => r.status === 202)).toBe(true);
      expect(await redis.ttl(key)).toBeGreaterThan(0);
      // Window about to expire: requests straddle the expiry. The key may be gone (-2) between
      // bursts, but never present without a TTL (-1).
      await redis.pexpire(key, 30);
      for (let i = 0; i < 6; i += 1) {
        await burst();
        expect(await redis.ttl(key)).not.toBe(-1);
        await new Promise((r) => setTimeout(r, 15));
      }
      await new Promise((r) => setTimeout(r, 50));
      await burst();
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(3500);
    });
  });

  describe('sessions die with the password (credentials version)', () => {
    const LOGIN = '/api/v1/auth/login';
    const cookieOf = (res: { headers: Record<string, unknown> }) =>
      (res.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ');
    const refreshOf = (res: { headers: Record<string, unknown> }) =>
      (res.headers['set-cookie'] as string[])
        .find((c) => c.startsWith(`${REFRESH_COOKIE}=`))!
        .split(';')[0]!
        .slice(REFRESH_COOKIE.length + 1);

    /**
     * Test seam between "login read the user (hash + version)" and "login created the session":
     * the next `createSession` call first runs `between`.
     */
    function onNextSessionCreation(between: () => Promise<void>): void {
      const sessions = ctx.app.get(SessionService);
      const original = sessions.createSession.bind(sessions);
      vi.spyOn(sessions, 'createSession').mockImplementationOnce(async (user, meta) => {
        await between();
        return original(user, meta);
      });
    }

    afterEach(() => vi.restoreAllMocks());

    it('the race: a login that read the old hash before a reset committed gets a session that is refused on first use', async () => {
      const u = await createUser();
      await ctx.http.post(FORGOT).send({ email: u.email }).expect(202);
      const token = await resetToken(ctx, u.email);
      onNextSessionCreation(async () => {
        await ctx.http.post(RESET).send({ token, newPassword: NEW_PASSWORD }).expect(200);
      });
      // The old password is verified, then the reset commits, then the session is created.
      const login = await ctx.http
        .post(LOGIN)
        .send({ email: u.email, password: u.password })
        .expect(200);

      const user = await ctx.db.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(user.credentialsVersion).toBe(1);
      const session = await ctx.db.userSession.findFirstOrThrow({
        where: { userId: u.id, revokedAt: null },
      });
      expect(session.credentialsVersion).toBe(0);
      const me = await as(ctx.http, cookieOf(login)).get('/api/v1/me').expect(401);
      expect(me.body.code).toBe('SESSION_REVOKED');
      const refreshed = await ctx.http
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE}=${refreshOf(login)}`)
        .expect(401);
      expect(refreshed.body.code).toBe('SESSION_REVOKED');
      // A login with the new password works.
      const fresh = await ctx.http
        .post(LOGIN)
        .send({ email: u.email, password: NEW_PASSWORD })
        .expect(200);
      await as(ctx.http, cookieOf(fresh)).get('/api/v1/me').expect(200);
    });

    it('the same race against a password change from another session', async () => {
      const u = await createUser();
      const changer = await loginAs(ctx, u, { userAgent: 'changer' });
      onNextSessionCreation(async () => {
        await as(ctx.http, changer.cookie)
          .patch(CHANGE)
          .send({ currentPassword: u.password, newPassword: NEW_PASSWORD })
          .expect(200);
      });
      const login = await ctx.http
        .post(LOGIN)
        .send({ email: u.email, password: u.password })
        .expect(200);
      await as(ctx.http, cookieOf(login)).get('/api/v1/me').expect(401);
      await as(ctx.http, changer.cookie).get('/api/v1/me').expect(200);
    });

    it('control: without a password change in between, the login session works', async () => {
      const u = await createUser();
      onNextSessionCreation(async () => undefined);
      const login = await ctx.http
        .post(LOGIN)
        .send({ email: u.email, password: u.password })
        .expect(200);
      await as(ctx.http, cookieOf(login)).get('/api/v1/me').expect(200);
    });

    it('reset increments the version and revokes the sessions in the same statement', async () => {
      const u = await createUser();
      await loginAs(ctx, u);
      await loginAs(ctx, u, { userAgent: 'other' });
      await ctx.http.post(FORGOT).send({ email: u.email }).expect(202);
      const token = await resetToken(ctx, u.email);
      await ctx.http.post(RESET).send({ token, newPassword: NEW_PASSWORD }).expect(200);
      const user = await ctx.db.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(user.credentialsVersion).toBe(1);
      expect(user.passwordChangedAt).toBeInstanceOf(Date);
      const sessions = await ctx.db.userSession.findMany({ where: { userId: u.id } });
      expect(sessions).toHaveLength(2);
      // One statement: one timestamp for the password stamp and every revocation.
      for (const s of sessions) expect(s.revokedAt).toEqual(user.passwordChangedAt);
    });

    it('change: the current session moves to the new version and survives, the others are revoked', async () => {
      const u = await createUser();
      const current = await loginAs(ctx, u);
      const other = await loginAs(ctx, u, { userAgent: 'other' });
      await as(ctx.http, current.cookie)
        .patch(CHANGE)
        .send({ currentPassword: u.password, newPassword: NEW_PASSWORD })
        .expect(200);
      const user = await ctx.db.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(user.credentialsVersion).toBe(1);
      const otherRow = await ctx.db.userSession.findUniqueOrThrow({
        where: { id: other.sessionId },
      });
      expect(otherRow.revokedAt).toEqual(user.passwordChangedAt);
      const currentRow = await ctx.db.userSession.findUniqueOrThrow({
        where: { id: current.sessionId },
      });
      expect(currentRow).toMatchObject({ revokedAt: null, credentialsVersion: 1 });
      await as(ctx.http, current.cookie).get('/api/v1/me').expect(200);
      await ctx.http
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE}=${current.refreshToken}`)
        .expect(200);
      await as(ctx.http, other.cookie).get('/api/v1/me').expect(401);
    });

    it('a change whose verified hash was replaced meanwhile (reset committed) is refused and changes nothing', async () => {
      const u = await createUser();
      const s = await loginAs(ctx, u);
      // Runs after the current password was verified, before the change transaction.
      vi.spyOn(ctx.app.get(PasswordPolicy), 'validate').mockImplementationOnce(async () => {
        await ctx.db.user.update({
          where: { id: u.id },
          data: { credentialsVersion: { increment: 1 } },
        });
        return { ok: true };
      });
      const res = await as(ctx.http, s.cookie)
        .patch(CHANGE)
        .send({ currentPassword: u.password, newPassword: NEW_PASSWORD })
        .expect(401);
      expect(res.body.code).toBe('SESSION_REVOKED');
      const user = await ctx.db.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(user.credentialsVersion).toBe(1);
      expect(await verifyPassword(user.passwordHash!, u.password)).toBe(true);
    });

    it('a sign-in that is locked out (Task 8) works again after a completed reset', async () => {
      const u = await createUser();
      const bad = { email: u.email, password: 'wrong wrong wrong' };
      // 10 failures for the email from two ips (5 per ip+email are free) lock the account.
      for (let i = 0; i < 10; i += 1) {
        await ctx.http
          .post(LOGIN)
          .set('X-Forwarded-For', `10.9.${i % 2}.1`)
          .send(bad)
          .expect(401);
      }
      const locked = await ctx.http
        .post(LOGIN)
        .set('X-Forwarded-For', '10.9.9.9')
        .send({ email: u.email, password: u.password })
        .expect(429);
      expect(locked.body.code).toBe('ACCOUNT_LOCKED');

      await ctx.http.post(FORGOT).send({ email: u.email }).expect(202);
      const token = await resetToken(ctx, u.email);
      await ctx.http.post(RESET).send({ token, newPassword: NEW_PASSWORD }).expect(200);
      await ctx.http
        .post(LOGIN)
        .set('X-Forwarded-For', '10.9.9.9')
        .send({ email: u.email, password: NEW_PASSWORD })
        .expect(200);
    });
  });

  describe('re-authentication limits', () => {
    it('5 wrong current passwords per 15 min, then 429 RATE_LIMITED with Retry-After (even with the right one)', async () => {
      const u = await createUser();
      const s = await loginAs(ctx, u);
      for (let i = 0; i < 5; i += 1) {
        await as(ctx.http, s.cookie)
          .patch(CHANGE)
          .send({ currentPassword: `faux mot de passe ${i}`, newPassword: NEW_PASSWORD })
          .expect(401);
      }
      const limited = await as(ctx.http, s.cookie)
        .patch(CHANGE)
        .send({ currentPassword: u.password, newPassword: NEW_PASSWORD })
        .expect(429);
      expect(limited.body.code).toBe('RATE_LIMITED');
      const retryAfter = limited.body.details.retryAfterS as number;
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(15 * 60);
      expect(limited.headers['retry-after']).toBe(String(retryAfter));
      // Shared with the email-change route.
      const viaEmail = await as(ctx.http, s.cookie)
        .post(EMAIL_CHANGE)
        .send({ newEmail: 'new@example.com', password: u.password })
        .expect(429);
      expect(viaEmail.headers['retry-after']).toBeDefined();
      expect(await redis.ttl(`auth:reauth-attempts:${u.id}`)).toBeGreaterThan(0);
    });

    it('concurrent wrong guesses cannot exceed the limit', async () => {
      const u = await createUser();
      const s = await loginAs(ctx, u);
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          as(ctx.http, s.cookie)
            .patch(CHANGE)
            .send({ currentPassword: `faux ${i} mot de passe`, newPassword: NEW_PASSWORD }),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((x) => x === 401)).toHaveLength(5);
      expect(statuses.filter((x) => x === 429)).toHaveLength(3);
    });

    it('a right password resets the count', async () => {
      const u = await createUser();
      const s = await loginAs(ctx, u);
      const wrong = () =>
        as(ctx.http, s.cookie)
          .post(EMAIL_CHANGE)
          .send({ newEmail: 'x@example.com', password: 'pas le bon mot de passe' });
      for (let i = 0; i < 4; i += 1) await wrong().expect(401);
      // Right password, taken address: the password check passed, so the count starts over.
      await createUser({ email: 'taken@example.com' });
      await as(ctx.http, s.cookie)
        .post(EMAIL_CHANGE)
        .send({ newEmail: 'taken@example.com', password: u.password })
        .expect(409);
      for (let i = 0; i < 5; i += 1) await wrong().expect(401);
      await wrong().expect(429);
    });

    it('email change requests: 3 per hour per user, successful ones included, then 429 with Retry-After', async () => {
      const u = await createUser();
      const s = await loginAs(ctx, u);
      for (let i = 1; i <= 3; i += 1) {
        await as(ctx.http, s.cookie)
          .post(EMAIL_CHANGE)
          .send({ newEmail: `new${i}@example.com`, password: u.password })
          .expect(202);
      }
      const sent = ctx.email.sent.length;
      const limited = await as(ctx.http, s.cookie)
        .post(EMAIL_CHANGE)
        .send({ newEmail: 'new4@example.com', password: u.password })
        .expect(429);
      expect(limited.body.code).toBe('RATE_LIMITED');
      expect(limited.body.details.retryAfterS).toBeGreaterThan(3500);
      expect(limited.headers['retry-after']).toBe(String(limited.body.details.retryAfterS));
      expect(ctx.email.sent).toHaveLength(sent);
      expect(await redis.ttl(`auth:email-change:${u.id}`)).toBeGreaterThan(0);
    });
  });

  describe('a password reset or change cancels a pending email change', () => {
    async function pendingEmailChange(u: Awaited<ReturnType<typeof createUser>>, cookie: string) {
      await as(ctx.http, cookie)
        .post(EMAIL_CHANGE)
        .send({ newEmail: 'new@example.com', password: u.password })
        .expect(202);
      const tOld = confirmToken(ctx, u.email);
      await ctx.http.post(CONFIRM).send({ token: tOld }).expect(200);
      return confirmToken(ctx, 'new@example.com');
    }

    it('reset', async () => {
      const u = await createUser({ email: 'old@example.com' });
      const s = await loginAs(ctx, u);
      const tNew = await pendingEmailChange(u, s.cookie);
      await ctx.http.post(FORGOT).send({ email: u.email }).expect(202);
      const token = await resetToken(ctx, u.email);
      await ctx.http.post(RESET).send({ token, newPassword: NEW_PASSWORD }).expect(200);
      expect(
        await ctx.db.verificationToken.count({
          where: { userId: u.id, purpose: { in: ['EMAIL_CHANGE_OLD', 'EMAIL_CHANGE_NEW'] } },
        }),
      ).toBe(0);
      await ctx.http.post(CONFIRM).send({ token: tNew }).expect(410);
      expect((await ctx.db.user.findUniqueOrThrow({ where: { id: u.id } })).email).toBe(
        'old@example.com',
      );
    });

    it('change', async () => {
      const u = await createUser({ email: 'old@example.com' });
      const s = await loginAs(ctx, u);
      const tNew = await pendingEmailChange(u, s.cookie);
      await as(ctx.http, s.cookie)
        .patch(CHANGE)
        .send({ currentPassword: u.password, newPassword: NEW_PASSWORD })
        .expect(200);
      expect(
        await ctx.db.verificationToken.count({
          where: { userId: u.id, purpose: { in: ['EMAIL_CHANGE_OLD', 'EMAIL_CHANGE_NEW'] } },
        }),
      ).toBe(0);
      await ctx.http.post(CONFIRM).send({ token: tNew }).expect(410);
    });
  });
});

describe('forgot-password background work: cap and shutdown', () => {
  const DELAY_MS = 400;

  class SlowEmailProvider extends InMemoryEmailProvider {
    override async send<K extends EmailTemplateKey>(msg: EmailMessage<K>) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      return super.send(msg);
    }
  }

  async function slowApp(): Promise<TestContext & { slow: SlowEmailProvider }> {
    const slow = new SlowEmailProvider();
    const ctx = await createTestApp({
      overrides: (b) => b.overrideProvider(EMAIL_PROVIDER).useValue(slow),
    });
    await ctx.reset();
    await clearForgotThrottle(ctx);
    return Object.assign(ctx, { slow });
  }

  it('beyond the in-flight cap, requests are dropped with a warning and still answer 202', async () => {
    const ctx = await slowApp();
    try {
      const service = ctx.app.get(PasswordResetService);
      service.maxInflight = 2;
      const warn = vi.spyOn((service as unknown as { logger: PinoLogger }).logger, 'warn');
      const users = await Promise.all([1, 2, 3].map(() => createUser()));
      for (const u of users) await ctx.http.post(FORGOT).send({ email: u.email }).expect(202);
      await ctx.app.get(PasswordResetService).drain();
      expect(ctx.slow.findByTemplate('auth.password_reset')).toHaveLength(2);
      expect(ctx.slow.findByTemplate('auth.password_reset', users[2]!.email)).toHaveLength(0);
      // (nestjs-pino keeps one root logger per process, so this second app's lines are not in
      // `ctx.logs`: spy on the service's logger instead.)
      expect(warn).toHaveBeenCalledWith(
        { inflight: 2 },
        'password reset request dropped: too many in flight',
      );
    } finally {
      await ctx.app.close();
    }
  });

  it('app.close() finishes the work in flight before the database pool is released', async () => {
    const ctx = await slowApp();
    const u = await createUser();
    await ctx.http.post(FORGOT).send({ email: u.email }).expect(202);
    expect(ctx.slow.sent).toHaveLength(0);
    await ctx.app.close();
    expect(ctx.slow.findByTemplate('auth.password_reset', u.email)).toHaveLength(1);
    const db = systemPrisma();
    expect(await db.verificationToken.count({ where: { userId: u.id } })).toBe(1);
    expect(
      await db.auditLog.count({
        where: { action: 'auth.password_reset_requested', entityId: u.id },
      }),
    ).toBe(1);
  });
});
