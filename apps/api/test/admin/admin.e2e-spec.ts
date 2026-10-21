import { EventEmitter2 } from '@nestjs/event-emitter';
import { QUEUES } from '@nibras/contracts';
import { CROSS_TENANT_AUDIT_ACTION, type PrismaClient, type User } from '@nibras/db';
import type { InMemoryEmailProvider } from '@nibras/providers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USER_SUSPENDED } from '../../src/admin/events';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import {
  createOrganization,
  createPersonalWorkspace,
  createUser,
  type CreateUserOptions,
} from '../helpers/factories';

/** Base32 TOTP seed: super-admins and organisation OWNER/ADMIN clear the 2FA gate with it. */
const S = 'JBSWY3DPEHPK3PXP';
const TIB = 1024n ** 4n;

const admin = (path: string) => `/api/v1/admin${path}`;

describe('super-admin console (US-X01/X02/X03, AC-SAFE-04 SP1 part)', () => {
  let ctx: TestContext;
  let http: TestAgent;
  let db: PrismaClient;
  let email: InMemoryEmailProvider;

  beforeAll(async () => {
    ctx = await createTestApp();
    ({ http, db, email } = ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  const agent = async (user: User) => as(http, (await loginAs(ctx, user)).cookie);
  const superAdmin = (o: Partial<CreateUserOptions> = {}) =>
    createUser({ platformRole: 'SUPER_ADMIN', totpSecret: S, ...o });

  it('non super-admin gets 403 on /admin/*; super-admin lists workspaces with member counts', async () => {
    const sa = await superAdmin();
    const owner = await createUser({ totpSecret: S, firstName: 'Nadia' });
    const students = await Promise.all([createUser(), createUser(), createUser()]);
    const { workspace: org } = await createOrganization({
      owner,
      students,
      name: 'École Ibn Khaldoun',
      members: [{ user: await createUser(), role: 'STUDENT', status: 'REMOVED' }],
    });
    const teacher = await createUser({ firstName: 'Karim' });
    const personal = await createPersonalWorkspace(teacher);

    const ownerAgent = await agent(owner);
    for (const [method, path] of [
      ['get', '/workspaces'],
      ['get', '/health'],
      ['post', `/workspaces/${org.id}/suspend`],
      ['post', `/workspaces/${org.id}/unsuspend`],
      ['patch', `/workspaces/${org.id}/quota`],
      ['post', `/users/${teacher.id}/suspend`],
      ['post', `/users/${teacher.id}/unsuspend`],
    ] as const) {
      await ownerAgent[method](admin(path))
        .send({ reason: 'x', storageQuotaBytes: 1 })
        .expect(403)
        .expect(({ body }) => expect(body.code, `${method} ${path}`).toBe('PERMISSION_DENIED'));
    }
    await http.get(admin('/workspaces')).expect(401);

    const saAgent = await agent(sa);
    const all = await saAgent.get(admin('/workspaces')).expect(200);
    expect(all.body.nextCursor).toBeNull();
    expect(all.body.items).toHaveLength(2);
    const byId = Object.fromEntries(
      (all.body.items as { id: string }[]).map((w) => [w.id, w]),
    ) as Record<string, unknown>;
    expect(byId[org.id]).toEqual({
      id: org.id,
      type: 'ORGANIZATION',
      name: 'École Ibn Khaldoun',
      slug: org.slug,
      status: 'ACTIVE',
      suspendedReason: null,
      // OWNER + 3 students; the REMOVED membership does not count.
      memberCount: 4,
      storageUsedBytes: '0',
      storageQuotaBytes: String(200n * 1024n ** 3n),
      createdAt: org.createdAt.toISOString(),
    });
    expect(byId[personal.id]).toMatchObject({
      type: 'PERSONAL',
      memberCount: 1,
      storageQuotaBytes: String(20n * 1024n ** 3n),
    });
    // The cross-tenant aggregate is audited against the super-admin.
    expect(
      await db.auditLog.findFirst({
        where: { action: CROSS_TENANT_AUDIT_ACTION, actorUserId: sa.id, entityType: 'Membership' },
      }),
    ).toMatchObject({ actorRole: 'SUPER_ADMIN', after: { operation: 'groupBy' } });

    // Filters and pagination.
    const personalOnly = await saAgent.get(admin('/workspaces?type=PERSONAL')).expect(200);
    expect(personalOnly.body.items.map((w: { id: string }) => w.id)).toEqual([personal.id]);
    const search = await saAgent.get(admin('/workspaces?q=khaldoun')).expect(200);
    expect(search.body.items.map((w: { id: string }) => w.id)).toEqual([org.id]);
    const page1 = await saAgent.get(admin('/workspaces?limit=1')).expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.nextCursor).toBe(page1.body.items[0].id);
    const page2 = await saAgent
      .get(admin(`/workspaces?limit=1&cursor=${page1.body.nextCursor}`))
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
    expect(page2.body.nextCursor).toBeNull();
    await saAgent.get(admin('/workspaces?status=SUSPENDED')).expect(200, {
      items: [],
      nextCursor: null,
    });
  });

  it('workspace suspend/unsuspend flips status with reason and audit; member sees 423 on mutations while suspended', async () => {
    const sa = await superAdmin();
    const owner = await createUser({ totpSecret: S });
    const { workspace } = await createOrganization({ owner });
    const ownerAgent = await agent(owner);
    const saAgent = await agent(sa);
    const suspend = admin(`/workspaces/${workspace.id}/suspend`);

    await saAgent.post(suspend).send({}).expect(422);
    await saAgent.post(suspend).send({ reason: 'Impayés' }).expect(204);
    const suspended = await db.workspace.findUniqueOrThrow({ where: { id: workspace.id } });
    expect(suspended).toMatchObject({ status: 'SUSPENDED', suspendedReason: 'Impayés' });
    expect(suspended.suspendedAt).toBeInstanceOf(Date);
    expect(
      await db.auditLog.findFirst({
        where: { action: 'workspace.suspended', entityId: workspace.id },
      }),
    ).toMatchObject({
      actorUserId: sa.id,
      actorRole: 'SUPER_ADMIN',
      workspaceId: workspace.id,
      before: { status: 'ACTIVE', suspendedReason: null },
      after: { status: 'SUSPENDED', suspendedReason: 'Impayés' },
    });

    // Read-only for its members (AC-WS-06).
    await ownerAgent.get(`/api/v1/workspaces/${workspace.id}`).expect(200);
    await ownerAgent
      .patch(`/api/v1/workspaces/${workspace.id}`)
      .send({ name: 'Autre' })
      .expect(423)
      .expect(({ body }) => {
        expect(body.code).toBe('WORKSPACE_SUSPENDED');
        expect(body.details).toEqual({ status: 'SUSPENDED', reason: 'Impayés' });
      });

    // Idempotent: a second suspension keeps the first reason and writes no audit row.
    await saAgent.post(suspend).send({ reason: 'Autre motif' }).expect(204);
    expect(await db.workspace.findUniqueOrThrow({ where: { id: workspace.id } })).toMatchObject({
      suspendedReason: 'Impayés',
    });
    expect(
      await db.auditLog.count({ where: { action: 'workspace.suspended', entityId: workspace.id } }),
    ).toBe(1);

    await saAgent.post(admin(`/workspaces/${workspace.id}/unsuspend`)).expect(204);
    expect(await db.workspace.findUniqueOrThrow({ where: { id: workspace.id } })).toMatchObject({
      status: 'ACTIVE',
      suspendedReason: null,
      suspendedAt: null,
    });
    expect(
      await db.auditLog.findFirst({
        where: { action: 'workspace.unsuspended', entityId: workspace.id },
      }),
    ).toMatchObject({
      actorUserId: sa.id,
      before: { status: 'SUSPENDED', suspendedReason: 'Impayés' },
      after: { status: 'ACTIVE' },
    });
    await saAgent.post(admin(`/workspaces/${workspace.id}/unsuspend`)).expect(204);
    expect(
      await db.auditLog.count({
        where: { action: 'workspace.unsuspended', entityId: workspace.id },
      }),
    ).toBe(1);
    await ownerAgent
      .patch(`/api/v1/workspaces/${workspace.id}`)
      .send({ name: 'Autre' })
      .expect(200);

    // Unknown or malformed workspace → 404; a DELETING one cannot be suspended.
    await saAgent
      .post(admin('/workspaces/0190a8b0-0000-7000-8000-000000000000/suspend'))
      .send({ reason: 'x' })
      .expect(404);
    await saAgent.post(admin('/workspaces/nope/suspend')).send({ reason: 'x' }).expect(404);
    const { workspace: deleting } = await createOrganization({
      owner: await createUser(),
      status: 'DELETING',
    });
    await saAgent
      .post(admin(`/workspaces/${deleting.id}/suspend`))
      .send({ reason: 'x' })
      .expect(422);
  });

  it('AC-SAFE-04 (SP1 part): suspending a teacher revokes sessions immediately, suspends his personal workspace read-only, emails him, audits, and emits UserSuspendedEvent; unsuspend restores both', async () => {
    const sa = await superAdmin();
    const teacher = await createUser();
    const personal = await createPersonalWorkspace(teacher);
    // An organisation he owns is not his personal space: it stays ACTIVE.
    const { workspace: org } = await createOrganization({ owner: teacher });
    const tSession = await loginAs(ctx, teacher);
    const events: unknown[] = [];
    const listener = (e: unknown) => events.push(e);
    ctx.app.get(EventEmitter2).on(USER_SUSPENDED, listener);
    try {
      await as(http, (await loginAs(ctx, sa)).cookie)
        .post(admin(`/users/${teacher.id}/suspend`))
        .send({ reason: 'Signalement confirmé' })
        .expect(204);
      await as(http, tSession.cookie).get('/api/v1/me').expect(401);
      await http
        .post('/api/v1/auth/login')
        .send({ email: teacher.email, password: teacher.password })
        .expect(403)
        .expect(({ body }) => expect(body.code).toBe('ACCOUNT_SUSPENDED'));
      expect(await db.user.findUniqueOrThrow({ where: { id: teacher.id } })).toMatchObject({
        status: 'SUSPENDED',
        suspendedReason: 'Signalement confirmé',
        suspendedAt: expect.any(Date),
      });
      expect(await db.workspace.findUniqueOrThrow({ where: { id: personal.id } })).toMatchObject({
        status: 'SUSPENDED',
        suspendedReason: 'OWNER_SUSPENDED',
      });
      expect((await db.workspace.findUniqueOrThrow({ where: { id: org.id } })).status).toBe(
        'ACTIVE',
      );
      expect(events).toEqual([{ userId: teacher.id, reason: 'Signalement confirmé' }]);
      const mails = email.findByTemplate('admin.user_suspended', teacher.email);
      expect(mails).toHaveLength(1);
      expect(mails[0]!.params).toEqual({
        firstName: teacher.firstName,
        reason: 'Signalement confirmé',
      });
      expect(
        await db.auditLog.findFirst({
          where: { action: 'user.suspended', entityId: teacher.id, actorUserId: sa.id },
        }),
      ).toMatchObject({
        actorRole: 'SUPER_ADMIN',
        before: { status: 'ACTIVE' },
        after: { status: 'SUSPENDED', suspendedReason: 'Signalement confirmé' },
      });
      expect(
        await db.auditLog.findFirst({
          where: { action: 'workspace.suspended', entityId: personal.id },
        }),
      ).toMatchObject({ actorUserId: sa.id, workspaceId: personal.id });
      expect(await db.userSession.count({ where: { userId: teacher.id, revokedAt: null } })).toBe(
        0,
      );

      // Idempotent: no second event, email or audit row.
      await as(http, (await loginAs(ctx, sa)).cookie)
        .post(admin(`/users/${teacher.id}/suspend`))
        .send({ reason: 'Encore' })
        .expect(204);
      expect(events).toHaveLength(1);
      expect(email.findByTemplate('admin.user_suspended', teacher.email)).toHaveLength(1);
      expect(await db.auditLog.count({ where: { action: 'user.suspended' } })).toBe(1);

      await as(http, (await loginAs(ctx, sa)).cookie)
        .post(admin(`/users/${teacher.id}/unsuspend`))
        .expect(204);
      expect((await db.workspace.findUniqueOrThrow({ where: { id: personal.id } })).status).toBe(
        'ACTIVE',
      );
      expect(await db.user.findUniqueOrThrow({ where: { id: teacher.id } })).toMatchObject({
        status: 'ACTIVE',
        suspendedReason: null,
        suspendedAt: null,
      });
      expect(email.findByTemplate('admin.user_unsuspended', teacher.email)).toHaveLength(1);
      expect(
        await db.auditLog.findFirst({
          where: { action: 'user.unsuspended', entityId: teacher.id, actorUserId: sa.id },
        }),
      ).toBeTruthy();
      await http
        .post('/api/v1/auth/login')
        .send({ email: teacher.email, password: teacher.password })
        .expect(200);
    } finally {
      ctx.app.get(EventEmitter2).off(USER_SUSPENDED, listener);
    }
  });

  it('unsuspending the owner leaves a personal workspace suspended by the admin for another reason', async () => {
    const sa = await superAdmin();
    const teacher = await createUser();
    const personal = await createPersonalWorkspace(teacher, {
      status: 'SUSPENDED',
      suspendedReason: 'Contenu illicite',
    });
    const saAgent = await agent(sa);
    await saAgent
      .post(admin(`/users/${teacher.id}/suspend`))
      .send({ reason: 'r' })
      .expect(204);
    expect(await db.workspace.findUniqueOrThrow({ where: { id: personal.id } })).toMatchObject({
      status: 'SUSPENDED',
      suspendedReason: 'Contenu illicite',
    });
    await saAgent.post(admin(`/users/${teacher.id}/unsuspend`)).expect(204);
    expect(await db.workspace.findUniqueOrThrow({ where: { id: personal.id } })).toMatchObject({
      status: 'SUSPENDED',
      suspendedReason: 'Contenu illicite',
    });
    // An OWNER_SUSPENDED workspace may still be reactivated directly by the admin.
    const other = await createUser();
    const otherPersonal = await createPersonalWorkspace(other);
    await saAgent
      .post(admin(`/users/${other.id}/suspend`))
      .send({ reason: 'r' })
      .expect(204);
    await saAgent.post(admin(`/workspaces/${otherPersonal.id}/unsuspend`)).expect(204);
    expect((await db.workspace.findUniqueOrThrow({ where: { id: otherPersonal.id } })).status).toBe(
      'ACTIVE',
    );
  });

  it('cannot suspend a super-admin (409); quota below usage is 422; /admin/health lists the six queues', async () => {
    const sa = await superAdmin();
    const other = await superAdmin();
    const saAgent = await agent(sa);
    for (const target of [other, sa]) {
      await saAgent
        .post(admin(`/users/${target.id}/suspend`))
        .send({ reason: 'x' })
        .expect(409)
        .expect(({ body }) => expect(body.code).toBe('CANNOT_SUSPEND_SUPER_ADMIN'));
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: other.id } })).status).toBe('ACTIVE');
    await saAgent
      .post(admin('/users/0190a8b0-0000-7000-8000-000000000000/suspend'))
      .send({ reason: 'x' })
      .expect(404);

    // Quota (US-X03).
    const owner = await createUser({ totpSecret: S });
    const { workspace } = await createOrganization({ owner });
    await db.workspace.update({
      where: { id: workspace.id },
      data: { storageUsedBytes: 5n * 1024n ** 3n },
    });
    const quota = admin(`/workspaces/${workspace.id}/quota`);
    await saAgent
      .patch(quota)
      .send({ storageQuotaBytes: String(4n * 1024n ** 3n) })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('VALIDATION_FAILED'));
    await saAgent
      .patch(quota)
      .send({ storageQuotaBytes: String(10n * TIB + 1n) })
      .expect(422);
    await saAgent.patch(quota).send({ storageQuotaBytes: -1 }).expect(422);
    const big = String(10n * TIB);
    await saAgent
      .patch(quota)
      .send({ storageQuotaBytes: big })
      .expect(200, { quotaBytes: big, usedBytes: String(5n * 1024n ** 3n), reservedBytes: '0' });
    expect(
      (await db.workspace.findUniqueOrThrow({ where: { id: workspace.id } })).storageQuotaBytes,
    ).toBe(10n * TIB);
    expect(
      await db.auditLog.findFirst({
        where: { action: 'workspace.quota_changed', entityId: workspace.id },
      }),
    ).toMatchObject({
      actorUserId: sa.id,
      workspaceId: workspace.id,
      before: { storageQuotaBytes: String(200n * 1024n ** 3n) },
      after: { storageQuotaBytes: big },
    });
    // Equal to usage is allowed; an unchanged quota writes no audit row.
    await saAgent
      .patch(quota)
      .send({ storageQuotaBytes: 5 * 1024 ** 3 })
      .expect(200);
    await saAgent
      .patch(quota)
      .send({ storageQuotaBytes: 5 * 1024 ** 3 })
      .expect(200);
    expect(
      await db.auditLog.count({
        where: { action: 'workspace.quota_changed', entityId: workspace.id },
      }),
    ).toBe(2);
    await saAgent
      .patch(admin('/workspaces/0190a8b0-0000-7000-8000-000000000000/quota'))
      .send({ storageQuotaBytes: 1 })
      .expect(404);

    // Health (US-X02).
    const health = await saAgent.get(admin('/health')).expect(200);
    expect(health.body).toMatchObject({ db: 'up', redis: 'up' });
    const names = Object.values(QUEUES);
    expect(names).toHaveLength(6);
    expect(health.body.queues).toHaveLength(names.length);
    expect(health.body.queues.map((q: { name: string }) => q.name)).toEqual(names);
    for (const q of health.body.queues) {
      expect(q).toEqual({
        name: q.name,
        waiting: expect.any(Number),
        active: expect.any(Number),
        delayed: expect.any(Number),
        failed: expect.any(Number),
      });
    }
  });
});
