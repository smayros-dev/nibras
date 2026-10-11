import { EventEmitter2 } from '@nestjs/event-emitter';
import { uuidv7 } from '@tt/db';
import { extractFirstLink } from '@tt/providers';
import type Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/auth/crypto/tokens';
import { EmailVerificationService } from '../../src/auth/email-verification.service';
import { TEACHER_REGISTERED, type TeacherRegisteredEvent } from '../../src/auth/events';
import { RequestContext } from '../../src/common/request-context';
import { REDIS } from '../../src/redis/redis.module';
import { createTestApp, type TestContext } from '../helpers/app';
import { createUser } from '../helpers/factories';

const body = {
  kind: 'TEACHER',
  firstName: 'Mohamed',
  lastName: 'Sfaxi',
  email: 'mohamed@example.com',
  password: 'un mot de passe assez long',
  locale: 'fr',
  timezone: 'Africa/Tunis',
  acceptTerms: true,
  acceptPrivacy: true,
};

describe('teacher registration and email verification', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  const register = (patch: Record<string, unknown> = {}) =>
    ctx.http.post('/api/v1/auth/register').send({ ...body, ...patch });

  const tokenFromLastEmail = (): string => {
    const link = extractFirstLink(ctx.email.last()!.html, '/verify-email');
    return new URL(link!).searchParams.get('token')!;
  };

  it('AC-AUTH-01: creates user, PERSONAL workspace as OWNER, consents and a verification email', async () => {
    const { db, email } = ctx;
    const res = await register().expect(201);
    const user = await db.user.findUniqueOrThrow({
      where: { email: 'mohamed@example.com' },
      include: { memberships: { include: { workspace: true } }, consents: true },
    });
    expect(user).toMatchObject({ status: 'ACTIVE', locale: 'fr', timezone: 'Africa/Tunis' });
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.memberships).toHaveLength(1);
    expect(user.memberships[0]).toMatchObject({ role: 'OWNER', status: 'ACTIVE' });
    expect(user.memberships[0]!.joinedAt).toBeInstanceOf(Date);
    const ws = user.memberships[0]!.workspace;
    expect(ws).toMatchObject({
      type: 'PERSONAL',
      name: 'Espace de Mohamed',
      ownerUserId: user.id,
      defaultTimezone: 'Africa/Tunis',
      defaultLocale: 'fr',
      storageQuotaBytes: 20n * 1024n ** 3n,
    });
    expect(ws.slug).toMatch(/^espace-de-mohamed-[a-z2-7]{6}$/);
    expect(ws.settings).toMatchObject({
      v: 1,
      default_timezone: 'Africa/Tunis',
      present_ratio: 0.75,
      default_reminder_offsets_min: [1440, 15, 0],
    });
    expect(user.consents.map((c) => [c.type, c.version, c.granted, c.workspaceId])).toEqual(
      expect.arrayContaining([
        ['TERMS', 'terms-2026-10', true, null],
        ['PRIVACY', 'privacy-2026-10', true, null],
      ]),
    );
    expect(user.consents).toHaveLength(2);
    expect(user.consents[0]!.ip).toBeTruthy();

    const mails = email.findByTemplate('auth.verify_email', 'mohamed@example.com');
    expect(mails).toHaveLength(1);
    expect(mails[0]!.locale).toBe('fr');
    expect(mails[0]!.params.firstName).toBe('Mohamed');
    expect(extractFirstLink(mails[0]!.html, '/fr/verify-email?token=')).toBeTruthy();

    const tokens = await db.verificationToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.purpose).toBe('EMAIL_VERIFY');
    expect(tokens[0]!.tokenHash).toBe(hashToken(tokenFromLastEmail()));
    const ttl = tokens[0]!.expiresAt.getTime() - tokens[0]!.createdAt.getTime();
    expect(Math.abs(ttl - 24 * 3600 * 1000)).toBeLessThan(60_000);

    const audit = await db.auditLog.findMany({
      where: { action: 'auth.registered', entityId: user.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityType: 'User', workspaceId: ws.id });
    expect(JSON.stringify(audit)).not.toMatch(/argon2|un mot de passe/);

    expect(res.body).toEqual({
      user: {
        id: user.id,
        email: 'mohamed@example.com',
        firstName: 'Mohamed',
        lastName: 'Sfaxi',
        locale: 'fr',
        timezone: 'Africa/Tunis',
        birthDate: null,
        phoneE164: null,
        phoneVerifiedAt: null,
        emailVerifiedAt: null,
        platformRole: 'NONE',
        status: 'ACTIVE',
        twoFactor: { enabled: false, required: false },
        pendingConsents: [],
      },
    });
  });

  it('emits TeacherRegisteredEvent after the commit', async () => {
    const events: TeacherRegisteredEvent[] = [];
    const listener = (e: TeacherRegisteredEvent) => events.push(e);
    const emitter = ctx.app.get(EventEmitter2);
    emitter.on(TEACHER_REGISTERED, listener);
    try {
      await register().expect(201);
    } finally {
      emitter.off(TEACHER_REGISTERED, listener);
    }
    const user = await ctx.db.user.findUniqueOrThrow({ where: { email: body.email } });
    const ws = await ctx.db.workspace.findFirstOrThrow({ where: { ownerUserId: user.id } });
    expect(events).toEqual([
      expect.objectContaining({ userId: user.id, workspaceId: ws.id, locale: 'fr' }),
    ]);
  });

  it('a throwing or rejecting TeacherRegisteredEvent listener never fails a committed registration', async () => {
    const emitter = ctx.app.get(EventEmitter2);
    const syncThrow = () => {
      throw new Error('listener boom (sync)');
    };
    const asyncReject = () => Promise.reject(new Error('listener boom (async)'));
    emitter.on(TEACHER_REGISTERED, syncThrow);
    emitter.on(TEACHER_REGISTERED, asyncReject);
    try {
      await register().expect(201);
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      emitter.off(TEACHER_REGISTERED, syncThrow);
      emitter.off(TEACHER_REGISTERED, asyncReject);
    }
    expect(await ctx.db.user.count({ where: { email: body.email } })).toBe(1);
    expect(ctx.logs.lines().some((l) => l.msg === 'TeacherRegisteredEvent listener failed')).toBe(
      true,
    );
  });

  it('stores the canonical form of the timezone', async () => {
    const canonical = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kolkata' }).resolvedOptions()
      .timeZone;
    await register({ timezone: 'Asia/Kolkata' }).expect(201);
    const user = await ctx.db.user.findUniqueOrThrow({ where: { email: body.email } });
    expect(user.timezone).toBe(canonical);
    const ws = await ctx.db.workspace.findFirstOrThrow({ where: { ownerUserId: user.id } });
    expect(ws.defaultTimezone).toBe(canonical);
    expect(ws.settings).toMatchObject({ default_timezone: canonical });
  });

  it('sends the verification email in the chosen locale', async () => {
    await register({ locale: 'ar', email: 'ar@example.com' }).expect(201);
    const mail = ctx.email.findByTemplate('auth.verify_email', 'ar@example.com')[0]!;
    expect(mail.locale).toBe('ar');
    expect(extractFirstLink(mail.html, '/ar/verify-email?token=')).toBeTruthy();
  });

  it('AC-AUTH-02: compromised password is refused without naming the source', async () => {
    ctx.pwned.add('un mot de passe compromis');
    const res = await register({ password: 'un mot de passe compromis' }).expect(422);
    expect(res.body.code).toBe('PASSWORD_COMPROMISED');
    expect(JSON.stringify(res.body)).not.toMatch(/hibp|pwned|haveibeenpwned/i);
    expect(await ctx.db.user.count()).toBe(0);
    expect(ctx.email.sent).toEqual([]);
  });

  it('rejects short and common passwords with their codes; an oversized one is VALIDATION_FAILED', async () => {
    const short = await register({ password: 'short' }).expect(422);
    expect(short.body.code).toBe('PASSWORD_TOO_SHORT');
    const common = await register({ password: 'password1234' }).expect(422);
    expect(common.body.code).toBe('PASSWORD_TOO_COMMON');
    const long = await register({ password: 'x'.repeat(257) }).expect(422);
    expect(long.body.code).toBe('VALIDATION_FAILED');
    // U+FDFA expands to 18 code points under NFKC: 20 of them stay under 256 UTF-16 units.
    const expanding = await register({ password: 'ﷺ'.repeat(20) }).expect(422);
    expect(expanding.body.code).toBe('VALIDATION_FAILED');
    expect(await ctx.db.user.count()).toBe(0);
  });

  it('normalises email: trims and lowercases; duplicate differing by case is 409 EMAIL_TAKEN', async () => {
    await register({ email: '  Mohamed@Example.com ' }).expect(201);
    expect(await ctx.db.user.count({ where: { email: 'mohamed@example.com' } })).toBe(1);
    expect(ctx.email.last()!.to).toBe('mohamed@example.com');
    const res = await register({ email: 'MOHAMED@example.com' }).expect(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
    expect(await ctx.db.user.count()).toBe(1);
    expect(await ctx.db.workspace.count()).toBe(1);
    expect(ctx.email.sent).toHaveLength(1);
  });

  it('concurrent registrations of one email yield exactly one account', async () => {
    const results = await Promise.all([
      register({ email: 'race@example.com' }),
      register({ email: 'Race@Example.com' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await ctx.db.user.count()).toBe(1);
    expect(await ctx.db.workspace.count()).toBe(1);
    expect(await ctx.db.consent.count()).toBe(2);
  });

  it('rejects invalid timezone and locale with 422 VALIDATION_FAILED', async () => {
    for (const patch of [
      { timezone: 'Europe/Tunis' },
      { timezone: 'GMT+1' },
      { locale: 'de' },
      { acceptTerms: false },
      { acceptPrivacy: false },
      { email: 'nope' },
      { kind: 'STUDENT' },
    ]) {
      const res = await register(patch).expect(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    expect(await ctx.db.user.count()).toBe(0);
  });

  it('verify-email marks the user verified once; second use and expired tokens are 410 TOKEN_INVALID', async () => {
    const { db, http } = ctx;
    await register().expect(201);
    const token = tokenFromLastEmail();
    const ok = await http.post('/api/v1/auth/verify-email').send({ token }).expect(200);
    expect(ok.body).toEqual({ ok: true });
    const user = await db.user.findUniqueOrThrow({ where: { email: body.email } });
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    const row = await db.verificationToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.usedAt).toBeInstanceOf(Date);

    const again = await http.post('/api/v1/auth/verify-email').send({ token }).expect(410);
    expect(again.body.code).toBe('TOKEN_INVALID');

    // Expired, unused token.
    const other = await createUser({ emailVerified: false });
    const raw = 'expired-token-raw-value-0123456789abcdefghij';
    await db.verificationToken.create({
      data: {
        userId: other.id,
        purpose: 'EMAIL_VERIFY',
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const expired = await http.post('/api/v1/auth/verify-email').send({ token: raw }).expect(410);
    expect(expired.body.code).toBe('TOKEN_INVALID');
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: other.id } })).emailVerifiedAt,
    ).toBeNull();

    const unknown = await http
      .post('/api/v1/auth/verify-email')
      .send({ token: 'never-issued' })
      .expect(410);
    expect(unknown.body.code).toBe('TOKEN_INVALID');
  });

  it('verify-email refuses a token of another purpose', async () => {
    const user = await createUser({ emailVerified: false });
    const raw = 'reset-token-raw-value-0123456789abcdefghijk';
    await ctx.db.verificationToken.create({
      data: {
        userId: user.id,
        purpose: 'PASSWORD_RESET',
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await ctx.http.post('/api/v1/auth/verify-email').send({ token: raw }).expect(410);
    expect(
      (await ctx.db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt,
    ).toBeNull();
  });

  it('verifying retires the other pending verification tokens of the user', async () => {
    const user = await createUser({ emailVerified: false });
    const [a, b] = [
      'pending-token-a-0123456789abcdefghijklmnop',
      'pending-token-b-0123456789abcdefghijklmnop',
    ];
    for (const raw of [a, b]) {
      await ctx.db.verificationToken.create({
        data: {
          userId: user.id,
          purpose: 'EMAIL_VERIFY',
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
    }
    await ctx.http.post('/api/v1/auth/verify-email').send({ token: a }).expect(200);
    await ctx.http.post('/api/v1/auth/verify-email').send({ token: b }).expect(410);
    expect(await ctx.db.verificationToken.count({ where: { userId: user.id, usedAt: null } })).toBe(
      0,
    );
  });

  it('a token used concurrently verifies exactly once', async () => {
    await register().expect(201);
    const token = tokenFromLastEmail();
    const results = await Promise.all(
      [1, 2, 3].map(() => ctx.http.post('/api/v1/auth/verify-email').send({ token })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 410, 410]);
  });

  it('different tokens of one user verified concurrently: one 200, the rest 410, never a deadlock', async () => {
    for (let round = 0; round < 3; round += 1) {
      const user = await createUser({ emailVerified: false });
      const raws = Array.from({ length: 6 }, (_, i) => `sibling-${round}-${i}-${user.id}`);
      await ctx.db.verificationToken.createMany({
        data: raws.map((raw) => ({
          userId: user.id,
          purpose: 'EMAIL_VERIFY' as const,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + 3600_000),
        })),
      });
      const results = await Promise.all(
        raws.map((token) => ctx.http.post('/api/v1/auth/verify-email').send({ token })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 410, 410, 410, 410, 410]);
      expect(
        await ctx.db.verificationToken.count({ where: { userId: user.id, usedAt: null } }),
      ).toBe(0);
    }
  });

  it('never writes the password or the raw token to the logs', async () => {
    await register().expect(201);
    const token = tokenFromLastEmail();
    await ctx.http.post('/api/v1/auth/verify-email').send({ token }).expect(200);
    const logs = JSON.stringify(ctx.logs.lines());
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(body.password);
  });

  it('resend-verification requires authentication', async () => {
    const res = await ctx.http.post('/api/v1/auth/resend-verification').send({}).expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  describe('EmailVerificationService.resend', () => {
    const asUser = <T>(user: { id: string }, fn: () => Promise<T>) =>
      RequestContext.run(
        { requestId: `resend-${user.id}`, ip: '127.0.0.1', userAgent: 'vitest' },
        fn,
      );

    it('invalidates earlier tokens and sends a new email; a second resend within a minute is 429', async () => {
      await register().expect(201);
      const first = tokenFromLastEmail();
      const user = await ctx.db.user.findUniqueOrThrow({ where: { email: body.email } });
      const service = ctx.app.get(EmailVerificationService);

      await asUser(user, () => service.resend(user));
      const mails = ctx.email.findByTemplate('auth.verify_email', body.email);
      expect(mails).toHaveLength(2);
      const second = tokenFromLastEmail();
      expect(second).not.toBe(first);

      await ctx.http.post('/api/v1/auth/verify-email').send({ token: first }).expect(410);

      await expect(asUser(user, () => service.resend(user))).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        status: 429,
      });
      expect(ctx.email.findByTemplate('auth.verify_email', body.email)).toHaveLength(2);

      await ctx.http.post('/api/v1/auth/verify-email').send({ token: second }).expect(200);
    });

    it('releases the cooldown when the database write fails, so the user can retry at once', async () => {
      const redis = ctx.app.get<Redis>(REDIS);
      // No such user: the token insert violates its foreign key.
      const ghost = {
        id: uuidv7(),
        email: 'ghost@example.com',
        firstName: 'Ghost',
        locale: 'fr' as const,
        emailVerifiedAt: null,
      };
      const key = `auth:resend-verification:${ghost.id}`;
      const service = ctx.app.get(EmailVerificationService);
      await expect(asUser(ghost, () => service.resend(ghost))).rejects.not.toMatchObject({
        code: 'RATE_LIMITED',
      });
      expect(await redis.exists(key)).toBe(0);
      await expect(asUser(ghost, () => service.resend(ghost))).rejects.not.toMatchObject({
        code: 'RATE_LIMITED',
      });
      expect(ctx.email.sent).toEqual([]);
    });

    it('does nothing for an already verified user', async () => {
      const user = await createUser({ emailVerified: true });
      await ctx.app.get(EmailVerificationService).resend(user);
      expect(ctx.email.sent).toEqual([]);
      expect(await ctx.db.verificationToken.count({ where: { userId: user.id } })).toBe(0);
    });
  });
});
