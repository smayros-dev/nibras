import type Redis from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { REDIS } from '../../src/redis/redis.module';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createUser } from '../helpers/factories';

describe('/me/phone: SMS one-time code verification (D-O6)', () => {
  let ctx: TestContext;
  let http: TestAgent;
  const nodeEnv = env.NODE_ENV;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = ctx.http;
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());
  afterEach(() => {
    (env as { NODE_ENV: string }).NODE_ENV = nodeEnv;
  });

  /** Lifts the 1 request/min limit of `userId` (stands in for waiting a minute). */
  const nextMinute = (userId: string) =>
    ctx.app.get<Redis>(REDIS).del(`phone:otp-request:${userId}`);

  it('request → verify sets phoneVerifiedAt; wrong code, expiry and 6th attempt are rejected', async () => {
    const { db, sms, email } = ctx;
    const u = await createUser();
    const s = await loginAs(ctx, u);
    await as(http, s.cookie)
      .post('/api/v1/me/phone/request-otp')
      .send({ phoneE164: '+21655123456' })
      .expect(202)
      .expect(({ body }) => expect(body).toEqual({}));
    const otpCode = sms.last('+21655123456')!.params.otpCode;
    expect(otpCode).toMatch(/^\d{6}$/);
    expect(sms.last('+21655123456')).toMatchObject({ templateKey: 'phone.otp', locale: 'fr' });
    expect(email.findByTemplate('phone.otp_dev', u.email)[0]?.params.otpCode).toBe(otpCode);
    // Stored as an argon2 hash only, valid 10 minutes.
    const row = await db.phoneOtp.findFirstOrThrow({ where: { userId: u.id } });
    expect(row.codeHash).toMatch(/^\$argon2id\$/);
    expect(row.codeHash).not.toContain(otpCode);
    expect(row.phoneE164).toBe('+21655123456');
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThan(9.9 * 60_000);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(
      10 * 60_000 + 1000,
    );
    // The number is not the account's until verified.
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).phoneE164).toBeNull();

    const wrong = otpCode === '000000' ? '111111' : '000000';
    await as(http, s.cookie)
      .post('/api/v1/me/phone/verify-otp')
      .send({ otpCode: wrong })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('OTP_INVALID'));
    await as(http, s.cookie)
      .post('/api/v1/me/phone/verify-otp')
      .send({ otpCode })
      .expect(200)
      .expect(({ body }) => {
        expect(body.phoneE164).toBe('+21655123456');
        expect(body.phoneVerifiedAt).toEqual(expect.any(String));
        expect(body.id).toBe(u.id);
      });
    const verified = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(verified.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(verified.phoneE164).toBe('+21655123456');
    // Single use: the code is gone.
    expect(await db.phoneOtp.count({ where: { userId: u.id } })).toBe(0);
    await as(http, s.cookie)
      .post('/api/v1/me/phone/verify-otp')
      .send({ otpCode })
      .expect(410)
      .expect(({ body }) => expect(body.code).toBe('OTP_EXPIRED'));
    const audits = await db.auditLog.findMany({ where: { action: 'phone.verified' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: u.id,
      actorRole: 'USER',
      entityType: 'User',
      entityId: u.id,
      before: { phoneE164: null, phoneVerifiedAt: null },
      after: {
        phoneE164: '+21655123456',
        phoneVerifiedAt: verified.phoneVerifiedAt!.toISOString(),
      },
    });
    expect(JSON.stringify(audits)).not.toContain(otpCode);

    // Expired: 410 even with the right code.
    const late = await createUser();
    const sLate = await loginAs(ctx, late);
    await as(http, sLate.cookie)
      .post('/api/v1/me/phone/request-otp')
      .send({ phoneE164: '+33612345678' })
      .expect(202);
    const lateCode = sms.last('+33612345678')!.params.otpCode;
    await db.phoneOtp.updateMany({
      where: { userId: late.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await as(http, sLate.cookie)
      .post('/api/v1/me/phone/verify-otp')
      .send({ otpCode: lateCode })
      .expect(410)
      .expect(({ body }) => expect(body.code).toBe('OTP_EXPIRED'));
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: late.id } })).phoneVerifiedAt,
    ).toBeNull();

    // Five wrong codes are 422; the 6th attempt is 410 even with the right code.
    const guesser = await createUser();
    const sGuess = await loginAs(ctx, guesser);
    await as(http, sGuess.cookie)
      .post('/api/v1/me/phone/request-otp')
      .send({ phoneE164: '+21698765432' })
      .expect(202);
    const guessCode = sms.last('+21698765432')!.params.otpCode;
    const bad = guessCode === '999999' ? '888888' : '999999';
    for (let i = 0; i < 5; i++) {
      await as(http, sGuess.cookie)
        .post('/api/v1/me/phone/verify-otp')
        .send({ otpCode: bad })
        .expect(422)
        .expect(({ body }) => expect(body.code).toBe('OTP_INVALID'));
    }
    await as(http, sGuess.cookie)
      .post('/api/v1/me/phone/verify-otp')
      .send({ otpCode: guessCode })
      .expect(410)
      .expect(({ body }) => expect(body.code).toBe('OTP_EXPIRED'));
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: guesser.id } })).phoneVerifiedAt,
    ).toBeNull();
  });

  it('rejects a non-E.164 or invalid number with 422 and a second request within a minute with 429', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    for (const phoneE164 of [
      '0612345678',
      '+216 55 123 456',
      '21655123456',
      '+2165512345',
      '+999123456789',
      '+33000000000',
      '',
      'not-a-number',
    ]) {
      await as(http, s.cookie)
        .post('/api/v1/me/phone/request-otp')
        .send({ phoneE164 })
        .expect(422)
        .expect(({ body }) => expect(body.code, phoneE164).toBe('VALIDATION_FAILED'));
    }
    await as(http, s.cookie)
      .post('/api/v1/me/phone/request-otp')
      .send({})
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('VALIDATION_FAILED'));
    // Invalid numbers did not use up the minute.
    expect(ctx.sms.sent).toHaveLength(0);

    await as(http, s.cookie)
      .post('/api/v1/me/phone/request-otp')
      .send({ phoneE164: '+21655123456' })
      .expect(202);
    await as(http, s.cookie)
      .post('/api/v1/me/phone/request-otp')
      .send({ phoneE164: '+21655123456' })
      .expect(429)
      .expect((res) => {
        expect(res.body.code).toBe('RATE_LIMITED');
        expect(res.body.details.retryAfterS).toBeGreaterThan(0);
        expect(res.body.details.retryAfterS).toBeLessThanOrEqual(60);
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      });
    expect(ctx.sms.sent).toHaveLength(1);
    // Per user: another account is not limited.
    const other = await createUser();
    const s2 = await loginAs(ctx, other);
    await as(http, s2.cookie)
      .post('/api/v1/me/phone/request-otp')
      .send({ phoneE164: '+21655123457' })
      .expect(202);
  });

  it('a new request replaces the pending code; changing a verified phone keeps it verified until the new code', async () => {
    const { db, sms } = ctx;
    const u = await createUser({ phoneVerified: true });
    const s = await loginAs(ctx, u);
    const before = await db.user.findUniqueOrThrow({ where: { id: u.id } });

    await as(http, s.cookie)
      .post('/api/v1/me/phone/request-otp')
      .send({ phoneE164: '+21655123456' })
      .expect(202);
    const first = sms.last('+21655123456')!.params.otpCode;
    await nextMinute(u.id);
    await as(http, s.cookie)
      .post('/api/v1/me/phone/request-otp')
      .send({ phoneE164: '+21655000111' })
      .expect(202);
    const second = sms.last('+21655000111')!.params.otpCode;
    expect(await db.phoneOtp.count({ where: { userId: u.id } })).toBe(1);
    // Requesting does not touch the verified number.
    expect(await db.user.findUniqueOrThrow({ where: { id: u.id } })).toMatchObject({
      phoneE164: before.phoneE164,
      phoneVerifiedAt: before.phoneVerifiedAt,
    });
    if (first !== second) {
      await as(http, s.cookie)
        .post('/api/v1/me/phone/verify-otp')
        .send({ otpCode: first })
        .expect(422)
        .expect(({ body }) => expect(body.code).toBe('OTP_INVALID'));
    }
    await as(http, s.cookie)
      .post('/api/v1/me/phone/verify-otp')
      .send({ otpCode: second })
      .expect(200)
      .expect(({ body }) => expect(body.phoneE164).toBe('+21655000111'));
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.phoneE164).toBe('+21655000111');
    expect(after.phoneVerifiedAt!.getTime()).toBeGreaterThan(before.phoneVerifiedAt!.getTime());
    expect(
      await db.auditLog.findFirst({ where: { action: 'phone.verified', entityId: u.id } }),
    ).toMatchObject({
      before: { phoneE164: before.phoneE164 },
      after: { phoneE164: '+21655000111' },
    });
  });

  it('verify without a pending code is 410 OTP_EXPIRED; a malformed code is 422 VALIDATION_FAILED', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    await as(http, s.cookie)
      .post('/api/v1/me/phone/verify-otp')
      .send({ otpCode: '123456' })
      .expect(410)
      .expect(({ body }) => expect(body.code).toBe('OTP_EXPIRED'));
    for (const body of [{ otpCode: '12345' }, { otpCode: 'abcdef' }, { code: '123456' }, {}]) {
      await as(http, s.cookie)
        .post('/api/v1/me/phone/verify-otp')
        .send(body)
        .expect(422)
        .expect(({ body: b }) => expect(b.code).toBe('VALIDATION_FAILED'));
    }
  });

  it('the development email copy of the code is not sent when NODE_ENV=production', async () => {
    const u = await createUser({ locale: 'ar' });
    const s = await loginAs(ctx, u);
    (env as { NODE_ENV: string }).NODE_ENV = 'production';
    await as(http, s.cookie)
      .post('/api/v1/me/phone/request-otp')
      .send({ phoneE164: '+21655123456' })
      .expect(202);
    expect(ctx.sms.last('+21655123456')).toMatchObject({ templateKey: 'phone.otp', locale: 'ar' });
    expect(ctx.email.findByTemplate('phone.otp_dev')).toHaveLength(0);
  });

  it('requires a signed-in user with a verified email', async () => {
    await http.post('/api/v1/me/phone/request-otp').send({ phoneE164: '+21655123456' }).expect(401);
    const u = await createUser({ emailVerified: false });
    const s = await loginAs(ctx, u);
    await as(http, s.cookie)
      .post('/api/v1/me/phone/request-otp')
      .send({ phoneE164: '+21655123456' })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('EMAIL_NOT_VERIFIED'));
    expect(ctx.sms.sent).toHaveLength(0);
  });
});
