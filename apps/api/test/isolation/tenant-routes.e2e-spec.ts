import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listRoutes, type RouteInfo } from '../../src/openapi/export';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createOrganization, createUser } from '../helpers/factories';
import { TENANT_ROUTE_EXEMPTIONS } from './exemptions';

/**
 * SP1 DoD: every route under `/workspaces/{wid}` answers `404 NOT_FOUND` — never 200/403/422 —
 * to callers with no membership there, whatever the method and body (AC-WS-01). The route list
 * comes from the app's own router (`listRoutes`), so a routing refactor cannot silently drop a
 * route out of the suite; `__probe` (test-only permission probes) and `TENANT_ROUTE_EXEMPTIONS`
 * are the only exclusions.
 *
 * The routes are only known once the app is booted (no top-level await: CommonJS), so the two
 * caller scenarios loop over the enumeration inside one test each — every assertion carries
 * `${method} ${path}` so a failure still names the route.
 */
const PREFIX = '/api/v1';
const TENANT = `${PREFIX}/workspaces/:wid`;
const WRITE = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

describe('tenant isolation over every /workspaces/{wid} route (SP1 DoD)', () => {
  let ctx: TestContext;
  let http: TestAgent;
  let routes: RouteInfo[];

  beforeAll(async () => {
    ctx = await createTestApp();
    ({ http } = ctx);
    routes = listRoutes(ctx.app)
      .map((r) => ({ ...r, path: r.path.startsWith(PREFIX) ? r.path : `${PREFIX}${r.path}` }))
      .filter((r) => r.path.startsWith(TENANT) && !r.path.includes('__probe'))
      .filter(
        (r) => !TENANT_ROUTE_EXEMPTIONS.some((e) => e.method === r.method && e.path === r.path),
      );
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  /** `route.path` with `:wid` replaced by `wid` and every other param by a syntactically valid uuid. */
  const url = (route: RouteInfo, wid: string): string =>
    route.path
      .split('/')
      .map((seg) => {
        if (!seg.startsWith(':')) return seg;
        if (seg === ':wid') return wid;
        return randomUUID();
      })
      .join('/');

  const call = async (user: Parameters<typeof loginAs>[1], route: RouteInfo, wid: string) => {
    const agent = as(http, (await loginAs(ctx, user)).cookie);
    const req = agent[route.method.toLowerCase() as 'get'](url(route, wid));
    return WRITE.has(route.method) ? req.send({}) : req;
  };

  it('enumerates at least the 15 workspace routes this plan created', () => {
    expect(routes.length).toBeGreaterThanOrEqual(15);
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining([
        'GET /api/v1/workspaces/:wid',
        'DELETE /api/v1/workspaces/:wid',
        'GET /api/v1/workspaces/:wid/settings',
        'GET /api/v1/workspaces/:wid/storage',
        'GET /api/v1/workspaces/:wid/members',
        'GET /api/v1/workspaces/:wid/assignments',
        'GET /api/v1/workspaces/:wid/audit-log',
        'POST /api/v1/workspaces/:wid/abuse-reports',
        // SP2 T4: email invitations.
        'GET /api/v1/workspaces/:wid/invitations',
        'POST /api/v1/workspaces/:wid/invitations',
        'GET /api/v1/workspaces/:wid/invitations/:id',
        'PATCH /api/v1/workspaces/:wid/invitations/:id',
        'POST /api/v1/workspaces/:wid/invitations/:id/resend',
        'DELETE /api/v1/workspaces/:wid/invitations/:id',
        // SP2 T6: invite links (group codes) and the approval queue.
        'GET /api/v1/workspaces/:wid/invite-links',
        'POST /api/v1/workspaces/:wid/invite-links',
        'PATCH /api/v1/workspaces/:wid/invite-links/:id',
        'DELETE /api/v1/workspaces/:wid/invite-links/:id',
        'POST /api/v1/workspaces/:wid/members/:uid/approve',
        'POST /api/v1/workspaces/:wid/members/:uid/reject',
        // SP2 T7: the teacher's guardian consent resend (the student's own resend lives under
        // /me/workspaces/:wid and is not a tenant route, D12).
        'POST /api/v1/workspaces/:wid/students/:uid/guardian/resend-consent',
      ]),
    );
  });

  it('the /me guardian resend and the public guardian routes are not tenant routes (D12)', () => {
    const all = listRoutes(ctx.app).map((r) => `${r.method} ${r.path}`);
    expect(all).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^POST (\/api\/v1)?\/me\/workspaces\/:wid\/guardian\/resend-consent$/,
        ),
      ]),
    );
    expect(
      routes.map((r) => r.path).filter((p) => /guardian-consent|\/guardian\/:token|\/me\//.test(p)),
    ).toEqual([]);
  });

  it('every tenant route → 404 for an active TEACHER of another organisation (+ audit)', async () => {
    for (const route of routes) {
      await ctx.reset();
      const { workspace: target } = await createOrganization({ owner: await createUser() });
      const teacher = await createUser();
      await createOrganization({ owner: await createUser(), teachers: [teacher] });
      const label = `${route.method} ${route.path}`;

      const res = await call(teacher, route, target.id);
      expect(res.status, label).toBe(404);
      expect(res.body.code, label).toBe('NOT_FOUND');
      expect(
        await ctx.db.auditLog.count({
          where: { action: 'auth.forbidden_workspace', entityId: target.id },
        }),
        label,
      ).toBe(1);
    }
  });

  it('every tenant route → 404 for a user with no membership', async () => {
    for (const route of routes) {
      await ctx.reset();
      const { workspace: target } = await createOrganization({ owner: await createUser() });
      const outsider = await createUser();
      const label = `${route.method} ${route.path}`;

      const res = await call(outsider, route, target.id);
      expect(res.status, label).toBe(404);
      expect(res.body.code, label).toBe('NOT_FOUND');
    }
  });
});
