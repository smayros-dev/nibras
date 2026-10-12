import { Controller, Get } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AllowUnverified } from '../../src/auth/decorators/allow-unverified';
import { CurrentUser } from '../../src/auth/decorators/current-user';
import { Public } from '../../src/auth/decorators/public';
import type { AuthUser } from '../../src/common/request-context';
import { RequestContext } from '../../src/common/request-context';
import { createTestApp, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createUser } from '../helpers/factories';

@Controller('__gates')
class GatedController {
  @Get('plain')
  plain(@CurrentUser() user: AuthUser): { id: string; sessionId?: string } {
    return { id: user.id, sessionId: RequestContext.get()?.session?.id };
  }

  @AllowUnverified()
  @Get('exempt')
  exempt(@CurrentUser() user: AuthUser): { id: string } {
    return { id: user.id };
  }

  @Public()
  @Get('public')
  open(): { user: string | null } {
    return { user: RequestContext.get()?.user?.id ?? null };
  }
}

/** Class-level `@AllowUnverified()` (e.g. the 2FA setup controller of Task 10). */
@AllowUnverified()
@Controller('__gates-exempt-class')
class ExemptClassController {
  @Get()
  get(@CurrentUser() user: AuthUser): { id: string } {
    return { id: user.id };
  }
}

describe('JwtAuthGuard + AccountGatesGuard', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ controllers: [GatedController, ExemptClassController] });
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  it('every route needs a session unless @Public(); public routes and probes stay open', async () => {
    await ctx.http
      .get('/api/v1/__gates/plain')
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('UNAUTHENTICATED'));
    await ctx.http
      .get('/api/v1/__gates/exempt')
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('UNAUTHENTICATED'));
    await ctx.http.get('/api/v1/__gates/public').expect(200, { user: null });
    await ctx.http.get('/health/live').expect(200);
    await ctx.http.get('/metrics').expect(200);
  });

  it('a verified active user passes; the guard fills RequestContext with user and session', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    await as(ctx.http, s.cookie)
      .get('/api/v1/__gates/plain')
      .expect(200, { id: u.id, sessionId: s.sessionId });
  });

  it('unverified email: 403 EMAIL_NOT_VERIFIED, except on @AllowUnverified routes', async () => {
    const u = await createUser({ emailVerified: false });
    const s = await loginAs(ctx, u);
    const client = as(ctx.http, s.cookie);
    for (const url of ['/api/v1/__gates/plain', '/api/v1/auth/sessions']) {
      await client
        .get(url)
        .expect(403)
        .expect(({ body }) => expect(body.code).toBe('EMAIL_NOT_VERIFIED'));
    }
    await client.delete('/api/v1/auth/sessions').expect(403);
    // Exempt: method- and class-level @AllowUnverified, GET /me, resend, logout.
    await client.get('/api/v1/__gates/exempt').expect(200, { id: u.id });
    await client.get('/api/v1/__gates-exempt-class').expect(200, { id: u.id });
    const me = await client.get('/api/v1/me').expect(200);
    expect(me.body).toMatchObject({ id: u.id, emailVerifiedAt: null });
    await client.post('/api/v1/auth/resend-verification').expect(200, { ok: true });
    expect(ctx.email.findByTemplate('auth.verify_email', u.email)).toHaveLength(1);
    await client.post('/api/v1/auth/logout').expect(204);
    await client.get('/api/v1/me').expect(401);
  });

  it('suspended user: 403 ACCOUNT_SUSPENDED everywhere, @AllowUnverified routes included; logout still works', async () => {
    const u = await createUser({ status: 'SUSPENDED', emailVerified: false });
    const s = await loginAs(ctx, u);
    const client = as(ctx.http, s.cookie);
    const suspended = ({ body }: { body: { code: string } }) =>
      expect(body.code).toBe('ACCOUNT_SUSPENDED');
    await client.get('/api/v1/__gates/plain').expect(403).expect(suspended);
    await client.get('/api/v1/auth/sessions').expect(403).expect(suspended);
    // PRD §8.1.6 / AC-SAFE-04: the exemption of unverified users does not cover suspension.
    await client.get('/api/v1/me').expect(403).expect(suspended);
    await client.post('/api/v1/auth/resend-verification').expect(403).expect(suspended);
    await client.get('/api/v1/__gates/exempt').expect(403).expect(suspended);
    await client.get('/api/v1/__gates-exempt-class').expect(403).expect(suspended);
    expect(ctx.email.sent).toEqual([]);
    // Logout is public and always works.
    await client.post('/api/v1/auth/logout').expect(204);
    expect(
      (await ctx.db.userSession.findUniqueOrThrow({ where: { id: s.sessionId } })).revokedAt,
    ).toBeInstanceOf(Date);
  });

  it('a user suspended mid-session is blocked at the next request (user row read per request)', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    await as(ctx.http, s.cookie).get('/api/v1/__gates/plain').expect(200);
    await ctx.db.user.update({ where: { id: u.id }, data: { status: 'SUSPENDED' } });
    await as(ctx.http, s.cookie)
      .get('/api/v1/__gates/plain')
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('ACCOUNT_SUSPENDED'));
  });

  it('a deleted account cannot use its sessions', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    await ctx.db.user.update({ where: { id: u.id }, data: { status: 'DELETED' } });
    await as(ctx.http, s.cookie)
      .get('/api/v1/me')
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('SESSION_REVOKED'));
  });

  it('guard rejections are counted in /metrics', async () => {
    await ctx.http.get('/api/v1/__gates/plain').expect(401);
    const metrics = await ctx.http.get('/metrics').expect(200);
    expect(metrics.text).toMatch(/http_request_duration_seconds_count\{[^}]*status="401"[^}]*\}/);
  });
});
