import { randomUUID } from 'node:crypto';
import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { PrismaClient } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../src/common/request-context';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import { createOrganization, createPersonalWorkspace, createUser } from '../helpers/factories';
import { TenancyProbeController } from '../helpers/tenancy-probe.controller';

/** Base32 TOTP seed: organisation OWNER/ADMIN and SUPER_ADMIN clear the 2FA gate with it. */
const S = 'JBSWY3DPEHPK3PXP';

const probe = (wid: string) => `/api/v1/workspaces/${wid}/__probe`;

/** A `:wid` route outside `/workspaces/:wid` (like Task 17's `/admin/workspaces/:wid/…`). */
@Controller('admin-probe/workspaces/:wid')
class AdminProbeController {
  @Get()
  read(): { workspaceId: string | undefined } {
    return { workspaceId: RequestContext.get()?.workspace?.id };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  write(): { workspaceId: string | undefined } {
    return { workspaceId: RequestContext.get()?.workspace?.id };
  }
}

/** `:wid` declared on the handler, controller path with slashes: still a tenant route. */
@Controller('/workspaces/')
class SplitPathProbeController {
  @Get('/:wid/__split/')
  read(): { workspaceId: string | undefined } {
    return { workspaceId: RequestContext.get()?.workspace?.id };
  }
}

describe('tenancy: WorkspaceContextGuard and PermissionGuard (AC-WS-01, AC-WS-03, AC-WS-06)', () => {
  let ctx: TestContext;
  let http: TestAgent;
  let db: PrismaClient;

  beforeAll(async () => {
    ctx = await createTestApp({
      controllers: [TenancyProbeController, AdminProbeController, SplitPathProbeController],
    });
    ({ http, db } = ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  const forbiddenAudits = (actorUserId: string, workspaceId: string) =>
    db.auditLog.findMany({
      where: { action: 'auth.forbidden_workspace', actorUserId, workspaceId },
    });

  it('AC-WS-01: teacher of org A calling org B gets 404 and an auth.forbidden_workspace audit row', async () => {
    const t = await createUser();
    await createOrganization({ owner: await createUser({ totpSecret: S }), teachers: [t] });
    const B = await createOrganization({ owner: await createUser({ totpSecret: S }) });
    const s = await loginAs(ctx, t);

    await as(http, s.cookie)
      .get(probe(B.workspace.id))
      .set('User-Agent', 'probe-agent')
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('NOT_FOUND'));
    // Mutations too: never a 403 that would reveal the workspace exists.
    await as(http, s.cookie)
      .post(probe(B.workspace.id))
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('NOT_FOUND'));
    const audits = await forbiddenAudits(t.id, B.workspace.id);
    expect(audits).toHaveLength(2);
    expect(audits.find((a) => a.userAgent === 'probe-agent')).toMatchObject({
      entityType: 'workspace',
      entityId: B.workspace.id,
      actorRole: 'USER',
      ip: expect.any(String),
      requestId: expect.any(String),
    });

    // An unknown workspace (or a malformed id) answers the same 404, with nothing to audit.
    const unknown = randomUUID();
    await as(http, s.cookie)
      .get(probe(unknown))
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('NOT_FOUND'));
    await as(http, s.cookie)
      .get(probe('not-a-uuid'))
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('NOT_FOUND'));
    expect(await db.auditLog.count({ where: { action: 'auth.forbidden_workspace' } })).toBe(2);
  });

  it('a member reaches the route; the context holds the workspace, the role and the scope', async () => {
    const t = await createUser();
    const owner = await createUser({ totpSecret: S });
    const A = await createOrganization({ owner, teachers: [t] });

    await as(http, (await loginAs(ctx, t)).cookie)
      .get(probe(A.workspace.id))
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({
          workspaceId: A.workspace.id,
          role: 'TEACHER',
          permissionScope: 'own',
        }),
      );
    await as(http, (await loginAs(ctx, owner)).cookie)
      .get(probe(A.workspace.id))
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ role: 'OWNER', permissionScope: 'all' }));
    expect(await db.auditLog.count({ where: { action: 'auth.forbidden_workspace' } })).toBe(0);
  });

  it('PermissionGuard: a ❌ cell → 403 PERMISSION_DENIED', async () => {
    const t = await createUser();
    const student = await createUser();
    const A = await createOrganization({
      owner: await createUser({ totpSecret: S }),
      teachers: [t],
      students: [student],
    });
    // TEACHER (org): settings ❌.
    await as(http, (await loginAs(ctx, t)).cookie)
      .post(probe(A.workspace.id))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('PERMISSION_DENIED'));
    // STUDENT: members list is not a student capability.
    await as(http, (await loginAs(ctx, student)).cookie)
      .get(probe(A.workspace.id))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('PERMISSION_DENIED'));
  });

  it('personal OWNER: settings ✅ (espace personnel)', async () => {
    const owner = await createUser();
    const ws = await createPersonalWorkspace(owner);
    const s = await loginAs(ctx, owner);
    await as(http, s.cookie)
      .post(probe(ws.id))
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ role: 'OWNER', permissionScope: 'all' }));
    await as(http, s.cookie)
      .post(`${probe(ws.id)}/course`)
      .expect(200);
  });

  it('AC-WS-03 over HTTP: admin without can_teach → 403 PERMISSION_DENIED on POST /course; with can_teach → 200', async () => {
    const admin = await createUser({ totpSecret: S });
    const teachingAdmin = await createUser({ totpSecret: S });
    const A = await createOrganization({
      owner: await createUser({ totpSecret: S }),
      admins: [admin],
      members: [{ user: teachingAdmin, role: 'ADMIN', canTeach: true }],
    });

    await as(http, (await loginAs(ctx, admin)).cookie)
      .post(`${probe(A.workspace.id)}/course`)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('PERMISSION_DENIED'));
    await as(http, (await loginAs(ctx, teachingAdmin)).cookie)
      .post(`${probe(A.workspace.id)}/course`)
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ role: 'ADMIN', permissionScope: 'all' }));
  });

  it('AC-WS-06: suspended workspace → GET 200, POST 423 WORKSPACE_SUSPENDED', async () => {
    const owner = await createUser({ totpSecret: S });
    const t = await createUser();
    const A = await createOrganization({
      owner,
      teachers: [t],
      status: 'SUSPENDED',
      suspendedReason: 'abuse investigation',
    });
    const s = await loginAs(ctx, owner);

    await as(http, s.cookie).get(probe(A.workspace.id)).expect(200);
    await http.head(probe(A.workspace.id)).set('Cookie', s.cookie).expect(200);
    await as(http, s.cookie)
      .post(probe(A.workspace.id))
      .expect(423)
      .expect(({ body }) => {
        expect(body.code).toBe('WORKSPACE_SUSPENDED');
        expect(body.details).toEqual({ status: 'SUSPENDED', reason: 'abuse investigation' });
      });
    // The suspended gate comes before the permission check: any mutation is 423.
    await as(http, (await loginAs(ctx, t)).cookie)
      .post(probe(A.workspace.id))
      .expect(423)
      .expect(({ body }) => expect(body.code).toBe('WORKSPACE_SUSPENDED'));
  });

  it('a DELETING workspace is read-only too', async () => {
    const owner = await createUser({ totpSecret: S });
    const A = await createOrganization({ owner, status: 'DELETING' });
    const s = await loginAs(ctx, owner);
    await as(http, s.cookie).get(probe(A.workspace.id)).expect(200);
    await as(http, s.cookie)
      .post(probe(A.workspace.id))
      .expect(423)
      .expect(({ body }) => {
        expect(body.code).toBe('WORKSPACE_SUSPENDED');
        expect(body.details).toEqual({ status: 'DELETING', reason: null });
      });
  });

  it('super-admin without membership gets 404 on workspace routes', async () => {
    const admin = await createUser({ platformRole: 'SUPER_ADMIN', totpSecret: S });
    const A = await createOrganization({ owner: await createUser({ totpSecret: S }) });
    await as(http, (await loginAs(ctx, admin)).cookie)
      .get(probe(A.workspace.id))
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('NOT_FOUND'));
    const [audit] = await forbiddenAudits(admin.id, A.workspace.id);
    expect(audit).toMatchObject({ actorRole: 'SUPER_ADMIN' });
  });

  it('REMOVED / REJECTED members get 404 (+ audit)', async () => {
    const removed = await createUser();
    const rejected = await createUser();
    const A = await createOrganization({
      owner: await createUser({ totpSecret: S }),
      members: [
        { user: removed, role: 'TEACHER', status: 'REMOVED' },
        { user: rejected, role: 'STUDENT', status: 'REJECTED' },
      ],
    });

    for (const u of [removed, rejected]) {
      await as(http, (await loginAs(ctx, u)).cookie)
        .get(probe(A.workspace.id))
        .expect(404)
        .expect(({ body }) => expect(body.code).toBe('NOT_FOUND'));
      expect(await forbiddenAudits(u.id, A.workspace.id)).toHaveLength(1);
    }
  });

  it.each([
    'PENDING_GUARDIAN_CONSENT',
    'SUSPENDED_NO_CONSENT',
    'SUSPENDED_CONSENT_REVOKED',
  ] as const)(
    '%s → 403 GUARDIAN_CONSENT_REQUIRED with details.status (no audit)',
    async (status) => {
      const minor = await createUser();
      const A = await createOrganization({
        owner: await createUser({ totpSecret: S }),
        members: [{ user: minor, role: 'STUDENT', status }],
      });
      const s = await loginAs(ctx, minor);
      for (const req of [
        as(http, s.cookie).get(probe(A.workspace.id)),
        as(http, s.cookie).post(probe(A.workspace.id)),
      ]) {
        await req.expect(403).expect(({ body }) => {
          expect(body.code).toBe('GUARDIAN_CONSENT_REQUIRED');
          expect(body.details).toEqual({ status });
        });
      }
      expect(await forbiddenAudits(minor.id, A.workspace.id)).toHaveLength(0);
    },
  );

  it('PENDING_APPROVAL → 403 MEMBERSHIP_INACTIVE with details.status', async () => {
    const pendingApproval = await createUser();
    const A = await createOrganization({
      owner: await createUser({ totpSecret: S }),
      members: [{ user: pendingApproval, role: 'STUDENT', status: 'PENDING_APPROVAL' }],
    });
    await as(http, (await loginAs(ctx, pendingApproval)).cookie)
      .get(probe(A.workspace.id))
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe('MEMBERSHIP_INACTIVE');
        expect(body.details).toEqual({ status: 'PENDING_APPROVAL' });
      });
    expect(await forbiddenAudits(pendingApproval.id, A.workspace.id)).toHaveLength(0);
  });

  it('runs after the session and account gates', async () => {
    const A = await createOrganization({ owner: await createUser({ totpSecret: S }) });
    await http
      .get(probe(A.workspace.id))
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('UNAUTHENTICATED'));
    // An organisation OWNER without TOTP is stopped by the 2FA gate before the tenancy guards.
    const owner = await createUser();
    const B = await createOrganization({ owner });
    await as(http, (await loginAs(ctx, owner)).cookie)
      .get(probe(B.workspace.id))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('TWO_FACTOR_SETUP_REQUIRED'));
  });

  it('only routes declared under workspaces/:wid are tenant routes (not /admin-probe/workspaces/:wid)', async () => {
    const superAdmin = await createUser({ platformRole: 'SUPER_ADMIN', totpSecret: S });
    const A = await createOrganization({
      owner: await createUser({ totpSecret: S }),
      status: 'SUSPENDED',
    });
    const s = await loginAs(ctx, superAdmin);
    const adminProbe = `/api/v1/admin-probe/workspaces/${A.workspace.id}`;

    // No membership, suspended workspace: neither 404 nor 423, and no workspace context.
    await as(http, s.cookie)
      .get(adminProbe)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({}));
    await as(http, s.cookie).post(adminProbe).expect(200);
    expect(await db.auditLog.count({ where: { action: 'auth.forbidden_workspace' } })).toBe(0);

    // `:wid` on the handler under a slash-wrapped `workspaces` controller is still guarded.
    await as(http, s.cookie)
      .get(`/api/v1/workspaces/${A.workspace.id}/__split`)
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('NOT_FOUND'));
    expect(await forbiddenAudits(superAdmin.id, A.workspace.id)).toHaveLength(1);
  });
});
