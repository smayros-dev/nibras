import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listRoutes, type RouteInfo } from '../../src/openapi/export';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { addMember, createOrganization, createStudent, createUser } from '../helpers/factories';
import { expectStructureInvariant } from '../helpers/invariants';
import { TENANT_ROUTE_EXEMPTIONS } from './exemptions';
import {
  BODYLESS_WRITE_ROUTES,
  FOREIGN_BODIES,
  FOREIGN_PARAMS,
  FOREIGN_QUERIES,
  LOCAL_PARAMS,
  createTenantPair,
  expectNoReporter,
  extraParams,
  foreignIds,
  hasParamFixtures,
  urlFor,
  type TenantPair,
} from './fixtures';

/**
 * SP1 DoD: every route under `/workspaces/{wid}` answers `404 NOT_FOUND` — never 200/403/422 —
 * to callers with no membership there, whatever the method and body (AC-WS-01). The route list
 * comes from the app's own router (`listRoutes`), so a routing refactor cannot silently drop a
 * route out of the suite; `__probe` (test-only permission probes) and `TENANT_ROUTE_EXEMPTIONS`
 * are the only exclusions.
 *
 * SP1.6 F8 adds the members' side of the same guarantee, on the same enumeration: an ACTIVE OWNER
 * of A reaching B's rows by id (path params, cursors, bodies), inactive memberships (`403
 * GUARDIAN_CONSENT_REQUIRED` for a minor without parental consent, `403 MEMBERSHIP_INACTIVE`
 * otherwise — SP2) and read-only workspaces (`423` on every write, never on a read). The ids
 * come from `fixtures.ts` (two organisations with disjoint users); a route whose param, cursor or
 * id-bearing body has no fixture fails the suite with a hint instead of being skipped.
 *
 * The routes are only known once the app is booted (no top-level await: CommonJS), so each
 * scenario loops over the enumeration inside one test — every assertion carries
 * `${method} ${path}` so a failure still names the route.
 */
const PREFIX = '/api/v1';
const TENANT = `${PREFIX}/workspaces/:wid`;
const WRITE = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
/**
 * The two outsider scenarios reset the database and build fresh organisations once per route; with
 * 40+ tenant routes (SP3 T6) they outgrow the default 15 s on a loaded machine.
 */
const ROUTE_LOOP_TIMEOUT_MS = 90_000;

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
        // SP3 T5: courses.
        'GET /api/v1/workspaces/:wid/courses',
        'POST /api/v1/workspaces/:wid/courses',
        'GET /api/v1/workspaces/:wid/courses/:cid',
        'PATCH /api/v1/workspaces/:wid/courses/:cid',
        'DELETE /api/v1/workspaces/:wid/courses/:cid',
        'POST /api/v1/workspaces/:wid/courses/:cid/publish',
        'POST /api/v1/workspaces/:wid/courses/:cid/unpublish',
        'POST /api/v1/workspaces/:wid/courses/:cid/archive',
        'POST /api/v1/workspaces/:wid/courses/:cid/restore',
        'POST /api/v1/workspaces/:wid/courses/:cid/reassign',
        // SP3 T6: structure.
        'GET /api/v1/workspaces/:wid/courses/:cid/structure',
        'POST /api/v1/workspaces/:wid/courses/:cid/modules',
        'POST /api/v1/workspaces/:wid/courses/:cid/modules/reorder',
        'PATCH /api/v1/workspaces/:wid/modules/:mid',
        'DELETE /api/v1/workspaces/:wid/modules/:mid',
        'POST /api/v1/workspaces/:wid/modules/:mid/lessons',
        'POST /api/v1/workspaces/:wid/modules/:mid/lessons/reorder',
        'GET /api/v1/workspaces/:wid/lessons/:lid',
        'PATCH /api/v1/workspaces/:wid/lessons/:lid',
        'DELETE /api/v1/workspaces/:wid/lessons/:lid',
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

  it(
    'every tenant route → 404 for an active TEACHER of another organisation (+ audit)',
    async () => {
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
    },
    ROUTE_LOOP_TIMEOUT_MS,
  );

  it(
    'every tenant route → 404 for a user with no membership',
    async () => {
      for (const route of routes) {
        await ctx.reset();
        const { workspace: target } = await createOrganization({ owner: await createUser() });
        const outsider = await createUser();
        const label = `${route.method} ${route.path}`;

        const res = await call(outsider, route, target.id);
        expect(res.status, label).toBe(404);
        expect(res.body.code, label).toBe('NOT_FOUND');
      }
    },
    ROUTE_LOOP_TIMEOUT_MS,
  );

  // ---- SP1.6 F8: an ACTIVE member of A reaching B, inactive members, read-only states ----

  const key = (route: RouteInfo): string => `${route.method} ${route.path}`;
  const isAbuseRoute = (route: RouteInfo): boolean => route.path.includes('/abuse-reports');

  const agentFor = async (user: Parameters<typeof loginAs>[1]) =>
    as(http, (await loginAs(ctx, user)).cookie);

  const send = (
    agent: Awaited<ReturnType<typeof agentFor>>,
    route: RouteInfo,
    path: string,
    body: unknown = {},
    headers: Record<string, string> = {},
  ) => {
    const req = agent[route.method.toLowerCase() as 'get'](path).set(headers);
    return WRITE.has(route.method) ? req.send(body as object) : req;
  };

  /** No id of B anywhere in the JSON of a response to A's member. */
  const expectNoForeignIds = (body: unknown, label: string, p: TenantPair): void => {
    const json = JSON.stringify(body ?? null);
    for (const id of foreignIds(p)) {
      expect(json, `${label}: response names B's ${id}`).not.toContain(id);
    }
  };

  const describeRes = (label: string, res: { status: number; body: unknown }): string =>
    `${label} → ${res.status} ${JSON.stringify(res.body)}`;

  it('foreign path params and cursors → 404 / 422 for an ACTIVE OWNER of A', async () => {
    const p = await createTenantPair();
    const owner = await agentFor(p.a.owner);
    const withParams = routes.filter((r) => extraParams(r).length > 0);
    expect(withParams.length).toBeGreaterThanOrEqual(6);

    for (const route of withParams) {
      const label = key(route);
      if (!hasParamFixtures(route, FOREIGN_PARAMS)) {
        expect.fail(`${label}: add a FOREIGN_PARAMS fixture`);
      }
      // A valid body, so the request reaches the service: only the foreign path id can refuse it.
      const body = FOREIGN_BODIES[label]?.body(p) ?? {};
      const path = urlFor(route, p.a.workspace.id, FOREIGN_PARAMS, p);
      const res = await send(owner, route, path, body);
      expect(res.status, describeRes(label, res)).toBe(404);
      expect(res.body.code, label).toBe('NOT_FOUND');
      expectNoForeignIds(res.body, label, p);
    }
    // SP2: B's rows the foreign-path writes named are untouched.
    const bInvitation = await ctx.db.invitation.findUniqueOrThrow({
      where: { id: p.b.invitation.id },
    });
    expect(bInvitation.status).toBe('PENDING');
    expect(bInvitation.tokenHash).toBe(p.b.invitation.tokenHash);
    expect(bInvitation.firstName).toBe(p.b.invitation.firstName);
    const bLink = await ctx.db.inviteLink.findUniqueOrThrow({ where: { id: p.b.inviteLink.id } });
    expect(bLink.status).toBe('ACTIVE');
    expect(bLink.label).toBe(p.b.inviteLink.label);
    const bStatus = async (userId: string) =>
      (
        await ctx.db.membership.findFirstOrThrow({
          where: { workspaceId: p.b.workspace.id, userId },
        })
      ).status;
    expect(await bStatus(p.b.pendingStudent.id)).toBe('PENDING_APPROVAL');
    expect(await bStatus(p.b.consentStudent.id)).toBe('PENDING_GUARDIAN_CONSENT');
    const bGuardian = await ctx.db.guardianLink.findUniqueOrThrow({
      where: { id: p.b.consentLink.id },
    });
    expect(bGuardian.consentTokenHash).toBe(p.b.consentLink.consentTokenHash);

    const known = new Set(routes.map(key));
    expect(Object.keys(FOREIGN_QUERIES).length).toBeGreaterThanOrEqual(3);
    for (const [label, query] of Object.entries(FOREIGN_QUERIES)) {
      expect(known.has(label), `${label}: FOREIGN_QUERIES names no route`).toBe(true);
      const route = routes.find((r) => key(r) === label)!;
      const res = await owner.get(urlFor(route, p.a.workspace.id, LOCAL_PARAMS, p)).query(query(p));
      expect(res.status, describeRes(label, res)).toBe(422);
      expect(res.body.code, label).toBe('VALIDATION_FAILED');
      expect(res.body.details.issues[0].path, label).toEqual(['cursor']);
      expectNoForeignIds(res.body, label, p);
    }
  });

  it('foreign ids in bodies never succeed', async () => {
    const p = await createTenantPair();
    const owner = await agentFor(p.a.owner);
    const known = new Set(routes.map(key));
    for (const label of [...Object.keys(FOREIGN_BODIES), ...BODYLESS_WRITE_ROUTES]) {
      expect(known.has(label), `${label}: stale FOREIGN_BODIES / BODYLESS entry`).toBe(true);
    }
    const counts = async () => ({
      assignments: await ctx.db.teacherStudentAssignment.count(),
      reports: await ctx.db.abuseReport.count(),
      memberships: await ctx.db.membership.count(),
      invitations: await ctx.db.invitation.count(),
      inviteLinks: await ctx.db.inviteLink.count(),
      courses: await ctx.db.course.count(),
      modules: await ctx.db.module.count(),
      lessons: await ctx.db.lesson.count(),
    });
    const before = await counts();

    const writes = routes.filter((r) => WRITE.has(r.method));
    expect(writes.length).toBeGreaterThanOrEqual(10);
    let probed = 0;
    for (const route of writes) {
      const label = key(route);
      const probe = FOREIGN_BODIES[label];
      if (!probe) {
        expect(
          BODYLESS_WRITE_ROUTES.has(label),
          `${label}: add a FOREIGN_BODIES fixture (or a reviewed BODYLESS_WRITE_ROUTES entry)`,
        ).toBe(true);
        continue;
      }
      expect(BODYLESS_WRITE_ROUTES.has(label), `${label}: also listed as bodyless`).toBe(false);
      const table = probe.params === 'local' ? LOCAL_PARAMS : FOREIGN_PARAMS;
      const path = urlFor(route, p.a.workspace.id, table, p);
      const res = await send(owner, route, path, probe.body(p), probe.headers);
      // Refused, and refused on purpose: a 5xx is a crash, not an isolation guarantee.
      expect(res.status, describeRes(label, res)).toBeGreaterThanOrEqual(400);
      expect(res.status, describeRes(label, res)).toBeLessThan(500);
      expectNoForeignIds(res.body, label, p);
      probed += 1;
    }
    expect(probed).toBeGreaterThanOrEqual(4);

    expect(await counts()).toEqual(before);
    const bIds = foreignIds(p);
    const wid = p.a.workspace.id;
    expect(
      await ctx.db.teacherStudentAssignment.count({
        where: {
          workspaceId: wid,
          OR: [{ teacherUserId: { in: bIds } }, { studentUserId: { in: bIds } }],
        },
      }),
    ).toBe(0);
    expect(
      await ctx.db.abuseReport.count({
        where: {
          workspaceId: wid,
          OR: [{ entityId: { in: bIds } }, { assignedToUserId: { in: bIds } }],
        },
      }),
    ).toBe(0);
    expect(
      await ctx.db.membership.count({ where: { workspaceId: wid, userId: { in: bIds } } }),
    ).toBe(0);
    expect(
      await ctx.db.invitation.count({ where: { workspaceId: wid, teacherUserId: { in: bIds } } }),
    ).toBe(0);
    expect(
      await ctx.db.inviteLink.count({ where: { workspaceId: wid, teacherUserId: { in: bIds } } }),
    ).toBe(0);
    // SP3: no course of A has B's image as cover or B's teacher as owner; A's course is untouched.
    expect(
      await ctx.db.course.count({
        where: {
          workspaceId: wid,
          OR: [{ coverMediaId: { in: bIds } }, { ownerUserId: { in: bIds } }],
        },
      }),
    ).toBe(0);
    const aCourse = await ctx.db.course.findUniqueOrThrow({ where: { id: p.a.course.id } });
    expect(aCourse).toMatchObject({ ownerUserId: p.a.teacher.id, coverMediaId: null, version: 1 });
    // SP3 T6: no lesson of A uses B's media or names B's image; A's structure kept its order.
    expect(
      await ctx.db.lesson.count({ where: { workspaceId: wid, mediaAssetId: { in: bIds } } }),
    ).toBe(0);
    const aLesson = await ctx.db.lesson.findUniqueOrThrow({ where: { id: p.a.lesson.id } });
    expect(JSON.stringify(aLesson.content)).not.toContain(p.b.coverImage.id);
    expect(aLesson).toMatchObject({ position: 1, version: 1 });
    expect((await ctx.db.module.findUniqueOrThrow({ where: { id: p.a.module.id } })).position).toBe(
      1,
    );
    await expectStructureInvariant(ctx.db, p.a.course.id);
    await expectStructureInvariant(ctx.db, p.b.course.id);
    // Nothing moved on either side: A keeps its owner, B's admin stays an ADMIN of B.
    expect((await ctx.db.workspace.findUniqueOrThrow({ where: { id: wid } })).ownerUserId).toBe(
      p.a.owner.id,
    );
    const bAdmin = await ctx.db.membership.findFirstOrThrow({
      where: { workspaceId: p.b.workspace.id, userId: p.b.admin.id },
    });
    expect(bAdmin.role).toBe('ADMIN');
  });

  it('inactive memberships → 403 GUARDIAN_CONSENT_REQUIRED / MEMBERSHIP_INACTIVE on every tenant route', async () => {
    const p = await createTenantPair();
    const pending = await createUser();
    await addMember(p.a.workspace, pending, 'TEACHER', { status: 'PENDING_APPROVAL' });
    // A minor whose guardian revoked the consent (SP2): the consent code, not the generic one.
    const { user: revoked } = await createStudent({
      workspace: p.a.workspace,
      status: 'SUSPENDED_CONSENT_REVOKED',
      minor: true,
    });

    for (const [user, status, code] of [
      [pending, 'PENDING_APPROVAL', 'MEMBERSHIP_INACTIVE'],
      [revoked, 'SUSPENDED_CONSENT_REVOKED', 'GUARDIAN_CONSENT_REQUIRED'],
    ] as const) {
      const agent = await agentFor(user);
      for (const route of routes) {
        const label = `${status}: ${key(route)}`;
        const res = await send(agent, route, urlFor(route, p.a.workspace.id, LOCAL_PARAMS, p));
        expect(res.status, describeRes(label, res)).toBe(403);
        expect(res.body.code, label).toBe(code);
        expect(res.body.details?.status, label).toBe(status);
      }
    }
  });

  it('SUSPENDED and DELETING workspaces → 423 on every write route, never on reads', async () => {
    const p = await createTenantPair();
    const owner = await agentFor(p.a.owner);
    const wid = p.a.workspace.id;

    for (const status of ['SUSPENDED', 'DELETING'] as const) {
      await ctx.db.workspace.update({
        where: { id: wid },
        data: {
          status,
          suspendedAt: status === 'SUSPENDED' ? new Date() : null,
          deletedAt: status === 'DELETING' ? new Date() : null,
        },
      });
      for (const route of routes) {
        const label = `${status}: ${key(route)}`;
        const res = await send(owner, route, urlFor(route, wid, LOCAL_PARAMS, p));
        if (WRITE.has(route.method)) {
          expect(res.status, describeRes(label, res)).toBe(423);
          expect(res.body.code, label).toBe('WORKSPACE_SUSPENDED');
          expect(res.body.details?.status, label).toBe(status);
        } else {
          // The OWNER keeps reading (AC-WS-06): A's own rows, never B's, never the reporter.
          expect(res.status, describeRes(label, res)).toBe(200);
          expectNoForeignIds(res.body, label, p);
          if (isAbuseRoute(route)) expectNoReporter(res.body, label, p.a.student);
        }
      }
    }
    // Every write was refused: the workspace still has its owner.
    expect((await ctx.db.workspace.findUniqueOrThrow({ where: { id: wid } })).ownerUserId).toBe(
      p.a.owner.id,
    );
  });
});
