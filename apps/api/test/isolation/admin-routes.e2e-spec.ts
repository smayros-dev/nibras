import { randomUUID } from 'node:crypto';
import type { User } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listRoutes, type RouteInfo } from '../../src/openapi/export';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createOrganization, createUser } from '../helpers/factories';
import { TOTP_SEED } from './fixtures';

/**
 * SP1.6 F8 (e): the platform console. Every `/api/v1/admin/**` route — enumerated from the app's
 * router like the tenant suite — answers `403 PERMISSION_DENIED` to an ACTIVE organisation OWNER
 * who cleared the 2FA gate (no 404 masking here: the console's existence is public), and anything
 * but `403` to a super-admin. Params are random uuids and bodies `{}`: the super-admin's answer
 * may be `404`/`422`, never a refusal, never a crash.
 */
const PREFIX = '/api/v1';
const ADMIN = `${PREFIX}/admin/`;
const WRITE = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

describe('platform console: every /admin route is super-admin only (SP1.6 F8)', () => {
  let ctx: TestContext;
  let http: TestAgent;
  let routes: RouteInfo[];

  beforeAll(async () => {
    ctx = await createTestApp();
    ({ http } = ctx);
    routes = listRoutes(ctx.app)
      .map((r) => ({ ...r, path: r.path.startsWith(PREFIX) ? r.path : `${PREFIX}${r.path}` }))
      .filter((r) => r.path.startsWith(ADMIN));
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  const url = (route: RouteInfo): string =>
    route.path
      .split('/')
      .map((seg) => (seg.startsWith(':') ? randomUUID() : seg))
      .join('/');

  const call = async (user: User, route: RouteInfo) => {
    const agent = as(http, (await loginAs(ctx, user)).cookie);
    const req = agent[route.method.toLowerCase() as 'get'](url(route));
    return WRITE.has(route.method) ? req.send({}) : req;
  };

  it('enumerates the console routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(10);
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining([
        'GET /api/v1/admin/workspaces',
        'POST /api/v1/admin/workspaces/:wid/suspend',
        'POST /api/v1/admin/users/:uid/suspend',
        'GET /api/v1/admin/abuse-reports',
        'GET /api/v1/admin/abuse-reports/:id',
        'PATCH /api/v1/admin/abuse-reports/:id',
      ]),
    );
  });

  it('an ACTIVE organisation OWNER (2FA on) → 403 PERMISSION_DENIED on every /admin route', async () => {
    const owner = await createUser({ totpSecret: TOTP_SEED });
    await createOrganization({ owner });
    for (const route of routes) {
      const label = `${route.method} ${route.path}`;
      const res = await call(owner, route);
      expect(res.status, `${label} → ${res.status} ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body.code, label).toBe('PERMISSION_DENIED');
    }
  });

  it('a super-admin is never refused on an /admin route (and never crashes it)', async () => {
    const sa = await createUser({ platformRole: 'SUPER_ADMIN', totpSecret: TOTP_SEED });
    for (const route of routes) {
      const label = `${route.method} ${route.path}`;
      const res = await call(sa, route);
      expect(res.status, `${label} → ${res.status} ${JSON.stringify(res.body)}`).not.toBe(403);
      expect(res.status, `${label} → ${res.status} ${JSON.stringify(res.body)}`).toBeLessThan(500);
    }
  });
});
