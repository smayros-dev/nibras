import { Controller, Get } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OptionalAuth } from '../../src/auth/decorators/optional-auth';
import { RequestContext } from '../../src/common/request-context';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createOrganization, createUser } from '../helpers/factories';

/** Test-only `@OptionalAuth()` route echoing what the guards stored in the request context. */
@Controller()
class OptionalProbeController {
  @OptionalAuth()
  @Get('optional-probe')
  probe(): { userId: string | null; sessionId: string | null } {
    const store = RequestContext.get();
    return { userId: store?.user?.id ?? null, sessionId: store?.session?.id ?? null };
  }
}

const PROBE = '/api/v1/optional-probe';

describe('@OptionalAuth() (SP2 public token routes)', () => {
  let ctx: TestContext;
  let http: TestAgent;

  beforeAll(async () => {
    ctx = await createTestApp({ controllers: [OptionalProbeController] });
    ({ http } = ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  it('passes anonymously, loads a valid session, refuses a suspended account, ignores unverified email / pending consents', async () => {
    await http.get(PROBE).expect(200, { userId: null, sessionId: null });

    const u = await createUser({ emailVerified: false, consents: [] });
    const s = await loginAs(ctx, u);
    await as(http, s.cookie)
      .get(PROBE)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ userId: u.id, sessionId: s.sessionId }));

    await as(http, 'nibras_access=garbage')
      .get(PROBE)
      .expect(200, { userId: null, sessionId: null });

    const suspended = await createUser({ status: 'SUSPENDED' });
    await as(http, (await loginAs(ctx, suspended)).cookie)
      .get(PROBE)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('ACCOUNT_SUSPENDED'));
  });

  it('a revoked session or a deleted account is anonymous, never 401', async () => {
    const u = await createUser();
    const s = await loginAs(ctx, u);
    await ctx.db.userSession.update({
      where: { id: s.sessionId },
      data: { revokedAt: new Date() },
    });
    await as(http, s.cookie).get(PROBE).expect(200, { userId: null, sessionId: null });

    const gone = await createUser();
    const g = await loginAs(ctx, gone);
    await ctx.db.user.update({ where: { id: gone.id }, data: { status: 'DELETED' } });
    await as(http, g.cookie).get(PROBE).expect(200, { userId: null, sessionId: null });
  });

  it('skips the 2FA-setup gate (organisation OWNER without TOTP)', async () => {
    const owner = await createUser();
    await createOrganization({ owner });
    await as(http, (await loginAs(ctx, owner)).cookie)
      .get(PROBE)
      .expect(200)
      .expect(({ body }) => expect(body.userId).toBe(owner.id));
  });
});
