import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient, User } from '@prisma/client';
import {
  createPrismaClient,
  crossTenantDb,
  CrossTenantFilterMissingError,
  db,
  onPrismaLog,
  resetDatabase,
  systemPrisma,
  TenantContextMissingError,
  tenantDb,
  TenantMismatchError,
  withTenantTx,
} from './index';
import { bindTenancy } from './tenant';

// DB-backed: two ORGANIZATION workspaces A and B, user `u` is a STUDENT member of both, each
// workspace also has one teacher profile and one teacher↔student assignment (seeded through the
// BYPASSRLS system role). Everything under test connects as `app_user` (no BYPASSRLS).
const url = process.env.DATABASE_URL_TEST;
const TENANT_TABLES = ['membership', 'teacher_profile', 'teacher_student_assignment'] as const;

let A: string;
let B: string;
let u: User;
let other: User;
let memberA: string;
let memberB: string;
const clients: PrismaClient[] = [];

function rawAppUser(query = ''): PrismaClient {
  const c = createPrismaClient(`${url}${query}`);
  clients.push(c);
  return c;
}

async function seed() {
  const sys = systemPrisma();
  u = await sys.user.create({ data: { email: 'u@example.com', firstName: 'U', lastName: 'U' } });
  other = await sys.user.create({
    data: { email: 'other@example.com', firstName: 'O', lastName: 'O' },
  });
  const ws = (slug: string) =>
    sys.workspace.create({
      data: {
        type: 'ORGANIZATION',
        name: slug,
        slug,
        ownerUserId: other.id,
        defaultTimezone: 'Africa/Tunis',
        defaultLocale: 'fr',
        storageQuotaBytes: 1n,
        settings: {},
      },
    });
  A = (await ws('ws-a')).id;
  B = (await ws('ws-b')).id;
  for (const workspaceId of [A, B]) {
    const m = await sys.membership.create({
      data: { workspaceId, userId: u.id, role: 'STUDENT', status: 'ACTIVE' },
    });
    if (workspaceId === A) memberA = m.id;
    else memberB = m.id;
    await sys.teacherProfile.create({ data: { workspaceId, userId: other.id, bio: 'b' } });
    await sys.teacherStudentAssignment.create({
      data: {
        workspaceId,
        teacherUserId: other.id,
        studentUserId: u.id,
        assignedByUserId: other.id,
      },
    });
  }
}

describe.skipIf(!url)('tenant isolation', () => {
  beforeEach(async () => {
    await resetDatabase();
    await seed();
  });
  afterAll(async () => {
    await Promise.all(clients.map((c) => c.$disconnect()));
  });

  describe('RLS layer (raw SQL as app_user, no Prisma extension)', () => {
    it('AC-WS-07: raw query as app_user without app.workspace_id returns 0 rows under RLS', async () => {
      const raw = rawAppUser();
      const rows = await raw.$queryRaw`SELECT id FROM membership`;
      expect(rows).toEqual([]);
      for (const table of TENANT_TABLES) {
        const [{ n }] = await raw.$queryRawUnsafe<[{ n: number }]>(
          `SELECT count(*)::int AS n FROM ${table}`,
        );
        expect(n, table).toBe(0);
      }
    });

    it('RLS is enabled and forced with a tenant_isolation policy on every tenant table', async () => {
      const rows = await systemPrisma().$queryRaw<
        { relname: string; rls: boolean; force: boolean; policies: string[] }[]
      >`
        SELECT c.relname::text, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
               coalesce(array_agg(p.polname::text) FILTER (WHERE p.polname IS NOT NULL), '{}') AS policies
        FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity
        GROUP BY 1, 2, 3 ORDER BY 1`;
      expect(rows).toEqual(
        [...TENANT_TABLES].sort().map((relname) => ({
          relname,
          rls: true,
          force: true,
          policies: ['tenant_isolation'],
        })),
      );
    });

    it('set_config(app.workspace_id) scopes raw reads to that workspace and WITH CHECK rejects writes to another', async () => {
      const raw = rawAppUser();
      for (const table of TENANT_TABLES) {
        const [, rows] = await raw.$transaction([
          raw.$executeRaw`SELECT set_config('app.workspace_id', ${A}, true)`,
          raw.$queryRawUnsafe<{ workspace_id: string }[]>(
            `SELECT workspace_id::text FROM ${table}`,
          ),
        ]);
        expect(rows, table).toEqual([{ workspace_id: A }]);
      }
      await expect(
        raw.$transaction([
          raw.$executeRaw`SELECT set_config('app.workspace_id', ${A}, true)`,
          raw.$executeRaw`INSERT INTO membership (id, workspace_id, user_id, role, status, updated_at)
            VALUES (gen_random_uuid(), ${B}::uuid, ${other.id}::uuid, 'STUDENT', 'ACTIVE', now())`,
        ]),
      ).rejects.toThrow(/row-level security/);
      // Update/delete of B's row under A's context touch nothing.
      const [, updated, deleted] = await raw.$transaction([
        raw.$executeRaw`SELECT set_config('app.workspace_id', ${A}, true)`,
        raw.$executeRaw`UPDATE membership SET can_teach = true WHERE id = ${memberB}::uuid`,
        raw.$executeRaw`DELETE FROM membership WHERE id = ${memberB}::uuid`,
      ]);
      expect([updated, deleted]).toEqual([0, 0]);
      // Moving A's row to B is rejected by WITH CHECK.
      await expect(
        raw.$transaction([
          raw.$executeRaw`SELECT set_config('app.workspace_id', ${A}, true)`,
          raw.$executeRaw`UPDATE membership SET workspace_id = ${B}::uuid WHERE id = ${memberA}::uuid`,
        ]),
      ).rejects.toThrow(/row-level security/);
    });

    it('app.bypass_tenant = on sees every workspace', async () => {
      const raw = rawAppUser();
      const [, rows] = await raw.$transaction([
        raw.$executeRaw`SELECT set_config('app.bypass_tenant', 'on', true)`,
        raw.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM membership`,
      ]);
      expect(rows).toEqual([{ n: 2 }]);
    });

    it('SET LOCAL does not leak to later statements on the same pooled connection', async () => {
      // One connection, so every statement below reuses the session that ran the scoped queries.
      const base = rawAppUser(`${url?.includes('?') ? '&' : '?'}connection_limit=1`);
      const t = bindTenancy(() => base);
      const settings = () =>
        base.$queryRaw<[{ wid: string | null; bypass: string | null; pid: number }]>`
          SELECT current_setting('app.workspace_id', true) AS wid,
                 current_setting('app.bypass_tenant', true) AS bypass,
                 pg_backend_pid() AS pid`;
      const [before] = await settings();
      expect(await t.tenantDb(A).membership.count()).toBe(1);
      expect(await t.crossTenantDb().membership.findMany({ where: { userId: u.id } })).toHaveLength(
        2,
      );
      await t.withTenantTx(A, (tx) => tx.membership.count());
      const [after] = await settings();
      expect(after.pid).toBe(before.pid);
      // Postgres resets a SET LOCAL placeholder to '' (not NULL) after the transaction.
      expect(after.wid ?? '').toBe('');
      expect(after.bypass ?? '').toBe('');
      // An empty app.workspace_id must still mean "0 rows", never a uuid cast error.
      expect(await base.$queryRaw`SELECT id FROM membership`).toEqual([]);
    });
  });

  describe('Prisma layer', () => {
    it('AC-WS-07: guarded client throws TENANT_CONTEXT_MISSING on a tenant model', async () => {
      await expect(db.membership.findMany()).rejects.toBeInstanceOf(TenantContextMissingError);
      await expect(db.teacherProfile.count()).rejects.toMatchObject({
        code: 'TENANT_CONTEXT_MISSING',
      });
      await expect(
        db.teacherStudentAssignment.create({
          data: {
            workspaceId: A,
            teacherUserId: other.id,
            studentUserId: u.id,
            assignedByUserId: other.id,
          },
        }),
      ).rejects.toBeInstanceOf(TenantContextMissingError);
    });

    it('guarded client passes non-tenant models through', async () => {
      expect(await db.user.count()).toBe(2);
      expect(await db.workspace.findMany({ where: { id: { in: [A, B] } } })).toHaveLength(2);
    });

    it('guarded client: nested tenant relations fail closed under RLS', async () => {
      const user = await db.user.findUniqueOrThrow({
        where: { id: u.id },
        include: { memberships: true },
      });
      expect(user.memberships).toEqual([]);
    });

    it('tenantDb(A) only sees A even with an explicit where on B', async () => {
      expect(await tenantDb(A).membership.count()).toBe(1);
      expect(await tenantDb(A).membership.findMany({ where: { workspaceId: B } })).toEqual([]); // injected A wins (where becomes AND)
      expect(await tenantDb(A).membership.findUnique({ where: { id: memberB } })).toBeNull();
      expect(
        await tenantDb(A).membership.findUnique({
          where: { workspaceId_userId: { workspaceId: B, userId: u.id } },
        }),
      ).toBeNull();
      expect(await tenantDb(A).membership.findFirst({ where: { userId: u.id } })).toMatchObject({
        id: memberA,
        workspaceId: A,
      });
      expect(await tenantDb(A).teacherProfile.findMany()).toHaveLength(1);
      expect(await tenantDb(B).teacherStudentAssignment.findMany()).toEqual([
        expect.objectContaining({ workspaceId: B }),
      ]);
      expect(
        await tenantDb(A).membership.aggregate({ _count: { _all: true }, where: { userId: u.id } }),
      ).toMatchObject({ _count: { _all: 1 } });
      expect(await tenantDb(A).membership.groupBy({ by: ['workspaceId'], _count: true })).toEqual([
        { workspaceId: A, _count: 1 },
      ]);
    });

    it('tenantDb(A) cannot update or delete B rows', async () => {
      await expect(
        tenantDb(A).membership.update({ where: { id: memberB }, data: { canTeach: true } }),
      ).rejects.toMatchObject({ code: 'P2025' });
      await expect(tenantDb(A).membership.delete({ where: { id: memberB } })).rejects.toMatchObject(
        { code: 'P2025' },
      );
      expect(
        await tenantDb(A).membership.updateMany({
          where: { id: memberB },
          data: { canTeach: true },
        }),
      ).toEqual({ count: 0 });
      expect(await tenantDb(A).membership.deleteMany()).toEqual({ count: 1 });
      const left = await systemPrisma().membership.findMany();
      expect(left).toEqual([expect.objectContaining({ id: memberB, canTeach: false })]);
    });

    it('tenantDb(A) refuses to create a row for B', async () => {
      await expect(
        tenantDb(A).membership.create({
          data: { workspaceId: B, userId: u.id, role: 'STUDENT', status: 'ACTIVE' },
        }),
      ).rejects.toThrow(/TenantMismatch/);
      await expect(
        tenantDb(A).membership.create({
          data: {
            workspace: { connect: { id: B } },
            user: { connect: { id: other.id } },
            role: 'STUDENT',
            status: 'ACTIVE',
          },
        }),
      ).rejects.toBeInstanceOf(TenantMismatchError);
      await expect(
        tenantDb(A).membership.createMany({
          data: [{ workspaceId: B, userId: other.id, role: 'STUDENT', status: 'ACTIVE' }],
        }),
      ).rejects.toBeInstanceOf(TenantMismatchError);
      await expect(
        tenantDb(A).membership.update({ where: { id: memberA }, data: { workspaceId: B } }),
      ).rejects.toBeInstanceOf(TenantMismatchError);
      await expect(
        tenantDb(A).membership.upsert({
          where: { id: memberA },
          create: { workspaceId: B, userId: u.id, role: 'STUDENT', status: 'ACTIVE' },
          update: {},
        }),
      ).rejects.toBeInstanceOf(TenantMismatchError);
      expect(await systemPrisma().membership.count()).toBe(2);
    });

    it('tenantDb(A) injects workspaceId on create, createMany and upsert', async () => {
      await systemPrisma().membership.deleteMany({ where: { workspaceId: A } });
      const created = await tenantDb(A).membership.create({
        // workspaceId omitted on purpose: the extension supplies it.
        data: { userId: u.id, role: 'STUDENT', status: 'ACTIVE' } as never,
      });
      expect(created.workspaceId).toBe(A);
      const connected = await tenantDb(A).teacherProfile.upsert({
        where: { workspaceId_userId: { workspaceId: A, userId: u.id } },
        create: { user: { connect: { id: u.id } }, workspace: { connect: { id: A } }, bio: 'x' },
        update: {},
      });
      expect(connected.workspaceId).toBe(A);
      expect(
        await tenantDb(B).membership.createMany({
          data: [{ userId: other.id, role: 'TEACHER', status: 'ACTIVE' } as never],
        }),
      ).toEqual({ count: 1 });
      expect(
        await systemPrisma().membership.count({ where: { workspaceId: B, userId: other.id } }),
      ).toBe(1);
    });

    it('tenantDb passes non-tenant models through', async () => {
      expect(await tenantDb(A).user.count()).toBe(2);
    });

    it('tenantDb rejects a workspace id that is not a uuid', () => {
      expect(() => tenantDb('not-a-uuid')).toThrow(TypeError);
    });

    it('tenantDb(A).$transaction is refused (use withTenantTx)', () => {
      expect(() => tenantDb(A).$transaction([])).toThrow(/withTenantTx/);
    });

    it('crossTenantDb requires a user filter and then sees both workspaces', async () => {
      await expect(crossTenantDb().membership.findMany()).rejects.toThrow(
        /CrossTenantFilterMissing/,
      );
      await expect(
        crossTenantDb().membership.findMany({ where: { userId: undefined } }),
      ).rejects.toBeInstanceOf(CrossTenantFilterMissingError);
      await expect(
        crossTenantDb().membership.findMany({ where: { userId: { not: u.id } } }),
      ).rejects.toBeInstanceOf(CrossTenantFilterMissingError);
      await expect(
        crossTenantDb().membership.findMany({ where: { OR: [{ userId: u.id }, {}] } }),
      ).rejects.toBeInstanceOf(CrossTenantFilterMissingError);
      await expect(
        crossTenantDb().membership.create({
          data: { workspaceId: A, userId: other.id, role: 'STUDENT', status: 'ACTIVE' },
        }),
      ).rejects.toBeInstanceOf(CrossTenantFilterMissingError);
      await expect(
        crossTenantDb().membership.upsert({
          where: { id: memberA },
          create: { workspaceId: B, userId: other.id, role: 'STUDENT', status: 'ACTIVE' },
          update: {},
        }),
      ).rejects.toBeInstanceOf(CrossTenantFilterMissingError);
      expect(await crossTenantDb().membership.findMany({ where: { userId: u.id } })).toHaveLength(
        2,
      );
      expect(
        await crossTenantDb().membership.findFirst({
          where: { userId: u.id, workspace: { slug: 'ws-b' } },
        }),
      ).toMatchObject({ id: memberB });
      expect(await crossTenantDb().membership.findUnique({ where: { id: memberB } })).toMatchObject(
        { workspaceId: B },
      );
      expect(await crossTenantDb().membership.count({ where: { userId: { in: [u.id] } } })).toBe(2);
      expect(await crossTenantDb().membership.findMany({ where: { userId: other.id } })).toEqual(
        [],
      );
    });

    it("crossTenantDb({ reason: 'super_admin' }) skips the filter check for console aggregates", async () => {
      const groups = await crossTenantDb({ reason: 'super_admin' }).membership.groupBy({
        by: ['workspaceId'],
        _count: true,
        orderBy: { workspaceId: 'asc' },
      });
      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g._count)).toEqual([1, 1]);
    });

    it('withTenantTx scopes reads, rejects other tenants and rolls back atomically', async () => {
      const seen = await withTenantTx(A, async (tx) => {
        const [{ n }] = await tx.$queryRaw<
          [{ n: number }]
        >`SELECT count(*)::int AS n FROM membership`;
        return { n, rows: await tx.membership.findMany({ where: { workspaceId: B } }) };
      });
      expect(seen).toEqual({ n: 1, rows: [] });
      await expect(
        withTenantTx(A, (tx) =>
          tx.membership.create({
            data: { workspaceId: B, userId: other.id, role: 'STUDENT', status: 'ACTIVE' },
          }),
        ),
      ).rejects.toBeInstanceOf(TenantMismatchError);
      await expect(
        withTenantTx(A, async (tx) => {
          await tx.membership.create({
            data: { userId: other.id, role: 'TEACHER', status: 'ACTIVE' } as never,
          });
          expect(await tx.membership.count()).toBe(2);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await systemPrisma().membership.count({ where: { workspaceId: A } })).toBe(1);
      const created = await withTenantTx(A, (tx) =>
        tx.membership.create({
          data: { userId: other.id, role: 'TEACHER', status: 'ACTIVE' } as never,
        }),
      );
      expect(created.workspaceId).toBe(A);
    });

    it('AC-GDPR-05: app_user cannot UPDATE or DELETE audit_log', async () => {
      const row = await systemPrisma().auditLog.create({
        data: { action: 'test', entityType: 'x', actorRole: 'SYSTEM', requestId: 'r' },
      });
      await expect(
        db.$executeRaw`UPDATE audit_log SET action = 'y' WHERE id = ${row.id}::uuid`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.$executeRaw`DELETE FROM audit_log WHERE id = ${row.id}::uuid`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.auditLog.update({ where: { id: row.id }, data: { action: 'z' } }),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.auditLog.create({
          data: { action: 'ok', entityType: 'x', actorRole: 'SYSTEM', requestId: 'r' },
        }),
      ).resolves.toBeTruthy();
      expect(await db.auditLog.findUnique({ where: { id: row.id } })).toMatchObject({
        action: 'test',
      });
    });

    it('onPrismaLog forwards error events of the app_user client', async () => {
      const seen: { level: string; message: string }[] = [];
      onPrismaLog((level, e) => seen.push({ level, message: e.message }));
      await expect(db.$queryRawUnsafe('SELECT * FROM no_such_table')).rejects.toThrow();
      expect(seen.some((e) => e.level === 'error')).toBe(true);
    });
  });
});
