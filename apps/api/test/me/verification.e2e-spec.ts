import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import * as contracts from '@nibras/contracts';
import { CONSENT_VERSIONS } from '@nibras/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireVerifiedTeacher } from '../../src/tenancy/decorators';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createUser, grantConsents } from '../helpers/factories';

/** Test-only route standing in for SP2/SP3/SP6's invite, publish and open-room routes. */
@Controller('__test')
class TeacherOnlyController {
  @Post('teacher-only')
  @HttpCode(HttpStatus.OK)
  @RequireVerifiedTeacher()
  teacherOnly(): { ok: true } {
    return { ok: true };
  }
}

describe('teacher verification: GET /me/verification and TeacherVerifiedGuard (AC-SAFE-01)', () => {
  let ctx: TestContext;
  let http: TestAgent;

  beforeAll(async () => {
    ctx = await createTestApp({ controllers: [TeacherOnlyController] });
    http = ctx.http;
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AC-SAFE-01 (guard): missing steps are listed; after OTP + code of conduct the route opens', async () => {
    const u = await createUser({ emailVerified: true });
    const s = await loginAs(ctx, u);
    await as(http, s.cookie)
      .get('/api/v1/me/verification')
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({
          emailVerified: true,
          phoneVerified: false,
          codeOfConductAccepted: false,
          missing: ['PHONE', 'CODE_OF_CONDUCT'],
        }),
      );
    await as(http, s.cookie)
      .post('/api/v1/__test/teacher-only')
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe('TEACHER_NOT_VERIFIED');
        expect(body.details.missing).toEqual(['PHONE', 'CODE_OF_CONDUCT']);
      });

    await as(http, s.cookie)
      .post('/api/v1/me/phone/request-otp')
      .send({ phoneE164: '+21655123456' })
      .expect(202);
    const otpCode = ctx.sms.last('+21655123456')!.params.otpCode;
    await as(http, s.cookie).post('/api/v1/me/phone/verify-otp').send({ otpCode }).expect(200);
    await as(http, s.cookie)
      .post('/api/v1/__test/teacher-only')
      .expect(403)
      .expect(({ body }) => expect(body.details.missing).toEqual(['CODE_OF_CONDUCT']));

    await as(http, s.cookie)
      .post('/api/v1/me/consents/CODE_OF_CONDUCT')
      .send({ version: 'coc-2026-10' })
      .expect(201);
    await as(http, s.cookie)
      .get('/api/v1/me/verification')
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({
          emailVerified: true,
          phoneVerified: true,
          codeOfConductAccepted: true,
          missing: [],
        }),
      );
    await as(http, s.cookie)
      .post('/api/v1/__test/teacher-only')
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ ok: true }));
  });

  it('the code of conduct counts only at its current version', async () => {
    const u = await createUser({ phoneVerified: true });
    await grantConsents(u, ['CODE_OF_CONDUCT']);
    const s = await loginAs(ctx, u);
    await as(http, s.cookie).post('/api/v1/__test/teacher-only').expect(200);

    vi.spyOn(contracts, 'CONSENT_VERSIONS', 'get').mockReturnValue({
      ...CONSENT_VERSIONS,
      CODE_OF_CONDUCT: 'coc-2027-01',
    } as never);
    await as(http, s.cookie)
      .post('/api/v1/__test/teacher-only')
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe('TEACHER_NOT_VERIFIED');
        expect(body.details).toEqual({ missing: ['CODE_OF_CONDUCT'] });
      });
    // A version bump of the code of conduct does not gate the rest of the account.
    await as(http, s.cookie).get('/api/v1/auth/sessions').expect(200);
    await as(http, s.cookie)
      .post('/api/v1/me/consents/CODE_OF_CONDUCT')
      .send({ version: 'coc-2027-01' })
      .expect(201);
    await as(http, s.cookie).post('/api/v1/__test/teacher-only').expect(200);
  });

  it('GET /me/verification is reachable before email verification and lists all three steps', async () => {
    const u = await createUser({ emailVerified: false });
    const s = await loginAs(ctx, u);
    await as(http, s.cookie)
      .get('/api/v1/me/verification')
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({
          emailVerified: false,
          phoneVerified: false,
          codeOfConductAccepted: false,
          missing: ['EMAIL', 'PHONE', 'CODE_OF_CONDUCT'],
        }),
      );
    // The account gates still run first on guarded routes.
    await as(http, s.cookie)
      .post('/api/v1/__test/teacher-only')
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('EMAIL_NOT_VERIFIED'));
    await http.get('/api/v1/me/verification').expect(401);
    await http.post('/api/v1/__test/teacher-only').expect(401);
  });

  it('a fully verified teacher passes; routes without the decorator are not gated', async () => {
    const verified = await createUser({ phoneVerified: true });
    await grantConsents(verified, ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT']);
    const sv = await loginAs(ctx, verified);
    await as(http, sv.cookie).post('/api/v1/__test/teacher-only').expect(200);

    const plain = await createUser();
    const sp = await loginAs(ctx, plain);
    await as(http, sp.cookie).get('/api/v1/auth/sessions').expect(200);
    await as(http, sp.cookie).get('/api/v1/me/workspaces').expect(200);
  });
});
