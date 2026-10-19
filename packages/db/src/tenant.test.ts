import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma, type PrismaClient, type User } from '@prisma/client';
import {
  CROSS_TENANT_AUDIT_ACTION,
  createPrismaClient,
  crossTenantDb,
  CrossTenantFilterMissingError,
  CrossTenantOperationError,
  db,
  NULLABLE_TENANT_MODELS,
  onPrismaLog,
  resetDatabase,
  systemPrisma,
  TENANT_MODELS,
  TenantContextMissingError,
  tenantDb,
  TenantMismatchError,
  uuidv7,
  withTenantTx,
} from './index';
import { bindTenancy } from './tenant';

// DB-backed seed (through the BYPASSRLS system role): ORGANIZATION workspaces A and B; user `u` is
// a STUDENT member of both; each workspace has one teacher profile and one teacher↔student
// assignment; `u` has an account-level TERMS consent and one RECORDING consent per workspace;
// `admin` is a SUPER_ADMIN. SP2: each workspace also has one invitation, invite link, guardian
// link (student `u`) and invitation import, whose secret columns end in the workspace slug.
const url = process.env.DATABASE_URL_TEST;
const TENANT_TABLES = [
  'membership',
  'teacher_profile',
  'teacher_student_assignment',
  'invitation',
  'invite_link',
  'guardian_link',
  'invitation_import',
] as const;

let A: string;
let B: string;
let u: User;
let other: User;
let admin: User;
let memberA: string;
let memberB: string;
let consentTerms: string;
let consentA: string;
let consentB: string;
const invitationOf: Record<string, string> = {};
const clients: PrismaClient[] = [];

function rawAppUser(query = ''): PrismaClient {
  const c = createPrismaClient(`${url}${query}`);
  clients.push(c);
  return c;
}

const consentData = (userId: string, type: 'TERMS' | 'RECORDING', workspaceId: string | null) => ({
  userId,
  type,
  workspaceId,
  version: 'v1',
  granted: true,
  grantedAt: new Date(),
  ip: '127.0.0.1',
  userAgent: 'vitest',
});

async function seed() {
  const sys = systemPrisma();
  const user = (email: string, platformRole: 'NONE' | 'SUPER_ADMIN' = 'NONE') =>
    sys.user.create({ data: { email, firstName: 'F', lastName: 'L', platformRole } });
  u = await user('u@example.com');
  other = await user('other@example.com');
  admin = await user('admin@example.com', 'SUPER_ADMIN');
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
  for (const [workspaceId, slug] of [
    [A, 'ws-a'],
    [B, 'ws-b'],
  ] as const) {
    const inv = await sys.invitation.create({
      data: {
        workspaceId,
        email: 'invitee@example.com',
        role: 'STUDENT',
        tokenHash: `token-${slug}`,
        expiresAt: new Date(Date.now() + 86_400_000),
        status: 'PENDING',
        invitedByUserId: other.id,
        lastSentAt: new Date(),
      },
    });
    invitationOf[workspaceId] = inv.id;
    await sys.inviteLink.create({
      data: {
        workspaceId,
        code: slug === 'ws-a' ? 'CODEAAAA' : 'CODEBBBB',
        role: 'STUDENT',
        createdByUserId: other.id,
        requiresApproval: false,
        maxUses: 50,
        status: 'ACTIVE',
      },
    });
    await sys.guardianLink.create({
      data: {
        workspaceId,
        studentUserId: u.id,
        guardianEmail: 'parent@example.com',
        status: 'PENDING',
        consentTokenHash: `consent-${slug}`,
        sessionsViewTokenHash: `view-${slug}`,
      },
    });
    await sys.invitationImport.create({
      data: {
        workspaceId,
        createdByUserId: other.id,
        fileName: 'eleves.csv',
        status: 'QUEUED',
        rows: [],
        report: [],
        totalRows: 0,
        validRows: 0,
      },
    });
  }
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
  consentTerms = (await sys.consent.create({ data: consentData(u.id, 'TERMS', null) })).id;
  consentA = (await sys.consent.create({ data: consentData(u.id, 'RECORDING', A) })).id;
  consentB = (await sys.consent.create({ data: consentData(u.id, 'RECORDING', B) })).id;
}

const superAdmin = () => ({
  reason: 'super_admin' as const,
  actor: { userId: admin.id, requestId: 'req-1' },
});

describe.skipIf(!url)('tenant isolation', () => {
  beforeEach(async () => {
    await resetDatabase();
    await seed();
  });
  afterAll(async () => {
    await Promise.all(clients.map((c) => c.$disconnect()));
  });

  describe('schema coverage (derived from TENANT_MODELS and the Prisma DMMF)', () => {
    const tableOf = (model: string) => {
      const m = Prisma.dmmf.datamodel.models.find((x) => x.name === model);
      if (!m) throw new Error(`unknown model ${model}`);
      return m.dbName ?? m.name;
    };

    it('every TENANT_MODELS / NULLABLE_TENANT_MODELS table has RLS enabled + forced + tenant_isolation, and no other table has RLS', async () => {
      const expected = [...TENANT_MODELS, ...NULLABLE_TENANT_MODELS].map(tableOf).sort();
      const rows = await systemPrisma().$queryRaw<
        { relname: string; rls: boolean; force: boolean; policies: string[] }[]
      >`
        SELECT c.relname::text, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
               coalesce(array_agg(p.polname::text) FILTER (WHERE p.polname IS NOT NULL), '{}') AS policies
        FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
          AND (c.relrowsecurity OR c.relforcerowsecurity OR p.polname IS NOT NULL)
        GROUP BY 1, 2, 3 ORDER BY 1`;
      expect(rows).toEqual(
        expected.map((relname) => ({
          relname,
          rls: true,
          force: true,
          policies: ['tenant_isolation'],
        })),
      );
    });

    it('every table with a NOT NULL workspace_id is a TENANT_MODELS table; nullable ones are classified', async () => {
      const cols = await systemPrisma().$queryRaw<{ table: string; nullable: boolean }[]>`
        SELECT table_name::text AS table, is_nullable = 'YES' AS nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'workspace_id' ORDER BY 1`;
      expect(cols.filter((c) => !c.nullable).map((c) => c.table)).toEqual(
        TENANT_MODELS.map(tableOf).sort(),
      );
      // Nullable workspace_id: consent is a nullable tenant table (RLS); audit_log and
      // abuse_report are platform tables read by super-admins (§11.7), deliberately not under RLS.
      // A new table here must be classified explicitly.
      expect(cols.filter((c) => c.nullable).map((c) => c.table)).toEqual([
        'abuse_report',
        'audit_log',
        ...NULLABLE_TENANT_MODELS.map(tableOf),
      ]);
    });
  });

  describe('RLS layer (raw SQL as app_user, no Prisma extension)', () => {
    const count = (c: PrismaClient, table: string) =>
      c.$queryRaw<[{ n: number }]>`SELECT count(*)::int AS n FROM ${Prisma.raw(table)}`;

    it('AC-WS-07: raw query as app_user without app.workspace_id returns 0 rows under RLS', async () => {
      const raw = rawAppUser();
      const rows = await raw.$queryRaw`SELECT id FROM membership`;
      expect(rows).toEqual([]);
      for (const table of TENANT_TABLES) {
        const [{ n }] = await count(raw, table);
        expect(n, table).toBe(0);
      }
    });

    it('set_config(app.workspace_id) scopes raw reads to that workspace and WITH CHECK rejects writes to another', async () => {
      const raw = rawAppUser();
      for (const table of TENANT_TABLES) {
        const [, rows] = await raw.$transaction([
          raw.$executeRaw`SELECT set_config('app.workspace_id', ${A}, true)`,
          raw.$queryRaw<
            { workspace_id: string }[]
          >`SELECT workspace_id::text FROM ${Prisma.raw(table)}`,
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
      const [, updated, deleted] = await raw.$transaction([
        raw.$executeRaw`SELECT set_config('app.workspace_id', ${A}, true)`,
        raw.$executeRaw`UPDATE membership SET can_teach = true WHERE id = ${memberB}::uuid`,
        raw.$executeRaw`DELETE FROM membership WHERE id = ${memberB}::uuid`,
      ]);
      expect([updated, deleted]).toEqual([0, 0]);
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
        count(raw, 'membership'),
      ]);
      expect(rows).toEqual([{ n: 2 }]);
    });

    it('consent: account-level rows without context, plus only that workspace with one; WITH CHECK on writes', async () => {
      const raw = rawAppUser();
      const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
      expect(ids(await raw.$queryRaw`SELECT id::text FROM consent`)).toEqual([consentTerms]);
      const [, inA] = await raw.$transaction([
        raw.$executeRaw`SELECT set_config('app.workspace_id', ${A}, true)`,
        raw.$queryRaw<{ id: string }[]>`SELECT id::text FROM consent`,
      ]);
      expect(ids(inA)).toEqual([consentTerms, consentA].sort());
      const insert = (workspaceId: string | null, type: string) =>
        raw.$executeRaw`INSERT INTO consent (id, user_id, type, version, granted, granted_at, ip, user_agent, workspace_id, updated_at)
          VALUES (gen_random_uuid(), ${other.id}::uuid, ${type}::"ConsentType", 'v1', true, now(), '127.0.0.1', 't', ${workspaceId}::uuid, now())`;
      await expect(insert(null, 'TERMS')).resolves.toBe(1);
      await expect(insert(B, 'RECORDING')).rejects.toThrow(/row-level security/);
      await expect(
        raw.$transaction([
          raw.$executeRaw`SELECT set_config('app.workspace_id', ${A}, true)`,
          insert(B, 'RECORDING'),
        ]),
      ).rejects.toThrow(/row-level security/);
      const [, revoked] = await raw.$transaction([
        raw.$executeRaw`SELECT set_config('app.workspace_id', ${A}, true)`,
        raw.$executeRaw`UPDATE consent SET revoked_at = now() WHERE id = ${consentB}::uuid`,
      ]);
      expect(revoked).toBe(0);
    });

    it('guarded db: tenant relations nested under a non-tenant model come back empty (fail closed)', async () => {
      const user = await db.user.findUniqueOrThrow({
        where: { id: u.id },
        include: { memberships: true, consents: true },
      });
      expect(user.memberships).toEqual([]);
      expect(user.consents.map((c) => c.id)).toEqual([consentTerms]);
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
      await t.crossTenantDb(superAdmin()).membership.count();
      await t.withTenantTx(A, (tx) => tx.membership.count());
      const [after] = await settings();
      expect(after.pid).toBe(before.pid);
      // Postgres resets a SET LOCAL placeholder to '' (not NULL) after the transaction.
      expect(after.wid ?? '').toBe('');
      expect(after.bypass ?? '').toBe('');
      // An empty app.workspace_id must still mean "0 rows", never a uuid cast error.
      expect(await base.$queryRaw`SELECT id FROM membership`).toEqual([]);
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
  });

  // The same Prisma-layer suite twice: as app_user (extension + RLS) and through the BYPASSRLS
  // system role, where RLS is inert and the extension alone must hold the line.
  describe.each([
    {
      name: 'app_user: extension + RLS',
      rls: true,
      t: () => ({ db, tenantDb, crossTenantDb, withTenantTx }),
    },
    {
      name: 'app_system BYPASSRLS: extension alone',
      rls: false,
      t: () => bindTenancy(() => systemPrisma()),
    },
  ])('Prisma layer ($name)', ({ rls, t }) => {
    it('AC-WS-07: guarded client throws TENANT_CONTEXT_MISSING on a tenant model', async () => {
      const { db } = t();
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
      const { db } = t();
      expect(await db.user.count()).toBe(3);
      expect(await db.workspace.findMany({ where: { id: { in: [A, B] } } })).toHaveLength(2);
    });

    it('guarded client: Consent is limited to account-level rows', async () => {
      const { db } = t();
      expect((await db.consent.findMany({ where: { userId: u.id } })).map((c) => c.id)).toEqual([
        consentTerms,
      ]);
      expect(await db.consent.findUnique({ where: { id: consentA } })).toBeNull();
      expect(
        await db.consent.updateMany({ where: { id: consentA }, data: { revokedAt: new Date() } }),
      ).toEqual({ count: 0 });
      await expect(
        db.consent.create({ data: consentData(other.id, 'RECORDING', A) }),
      ).rejects.toBeInstanceOf(TenantContextMissingError);
      await expect(
        db.consent.create({ data: consentData(other.id, 'TERMS', null) }),
      ).resolves.toBeTruthy();
    });

    it('tenantDb(A) only sees A even with an explicit where on B', async () => {
      const { tenantDb } = t();
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
      const { tenantDb } = t();
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
      const { tenantDb } = t();
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
      const { tenantDb } = t();
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

    it('tenantDb(A).consent sees account-level and A consents, never B', async () => {
      const { tenantDb } = t();
      const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
      expect(ids(await tenantDb(A).consent.findMany({ where: { userId: u.id } }))).toEqual(
        [consentTerms, consentA].sort(),
      );
      expect(await tenantDb(A).consent.findMany({ where: { workspaceId: B } })).toEqual([]);
      expect(await tenantDb(A).consent.findUnique({ where: { id: consentB } })).toBeNull();
      expect(
        await tenantDb(A).consent.updateMany({
          where: { id: consentB },
          data: { revokedAt: new Date() },
        }),
      ).toEqual({ count: 0 });
      await expect(
        tenantDb(A).consent.create({ data: consentData(other.id, 'RECORDING', B) }),
      ).rejects.toBeInstanceOf(TenantMismatchError);
      await expect(
        tenantDb(A).consent.update({ where: { id: consentA }, data: { workspaceId: B } }),
      ).rejects.toBeInstanceOf(TenantMismatchError);
      // Not filled in: NULL means account-level (the CHECK constraint ties it to the type).
      const terms = await tenantDb(A).consent.create({
        data: consentData(other.id, 'TERMS', null),
      });
      expect(terms.workspaceId).toBeNull();
      const rec = await tenantDb(A).consent.create({
        data: consentData(other.id, 'RECORDING', A),
      });
      expect(rec.workspaceId).toBe(A);
    });

    it('tenantDb passes non-tenant models through; validates the id; refuses $transaction', () => {
      const { tenantDb } = t();
      expect(() => tenantDb('not-a-uuid')).toThrow(TypeError);
      expect(() => tenantDb(A).$transaction([])).toThrow(/withTenantTx/);
      return expect(tenantDb(A).user.count()).resolves.toBe(3);
    });

    it('crossTenantDb requires a user filter and then sees both workspaces', async () => {
      const { crossTenantDb } = t();
      await expect(crossTenantDb().membership.findMany()).rejects.toThrow(
        /CrossTenantFilterMissing/,
      );
      for (const where of [
        { userId: undefined },
        { userId: { not: u.id } },
        { OR: [{ userId: u.id }, {}] },
      ]) {
        await expect(crossTenantDb().membership.findMany({ where })).rejects.toBeInstanceOf(
          CrossTenantFilterMissingError,
        );
      }
      expect(await crossTenantDb().membership.findMany({ where: { userId: u.id } })).toHaveLength(
        2,
      );
      expect(
        await crossTenantDb().membership.findFirst({
          where: { userId: u.id, workspace: { slug: 'ws-b' } },
          include: { workspace: true },
        }),
      ).toMatchObject({ id: memberB, workspace: { slug: 'ws-b' } });
      expect(await crossTenantDb().membership.findUnique({ where: { id: memberB } })).toMatchObject(
        { workspaceId: B },
      );
      expect(await crossTenantDb().membership.count({ where: { userId: { in: [u.id] } } })).toBe(2);
      expect(await crossTenantDb().membership.findMany({ where: { userId: other.id } })).toEqual(
        [],
      );
      expect(await crossTenantDb().consent.findMany({ where: { userId: u.id } })).toHaveLength(3);
    });

    it('tenantDb(A) refuses to create an invitation for B; guarded db throws TENANT_CONTEXT_MISSING on invitation.findFirst', async () => {
      const { db, tenantDb } = t();
      await expect(db.invitation.findFirst()).rejects.toBeInstanceOf(TenantContextMissingError);
      await expect(db.inviteLink.count()).rejects.toMatchObject({ code: 'TENANT_CONTEXT_MISSING' });
      await expect(db.guardianLink.findMany()).rejects.toBeInstanceOf(TenantContextMissingError);
      await expect(db.invitationImport.findMany()).rejects.toBeInstanceOf(
        TenantContextMissingError,
      );
      await expect(
        tenantDb(A).invitation.create({
          data: {
            workspaceId: B,
            email: 'x@example.com',
            role: 'STUDENT',
            tokenHash: 'evil',
            expiresAt: new Date(),
            status: 'PENDING',
            invitedByUserId: other.id,
            lastSentAt: new Date(),
          },
        }),
      ).rejects.toBeInstanceOf(TenantMismatchError);
      await expect(
        tenantDb(A).invitation.update({
          where: { id: invitationOf[A] },
          data: { workspaceId: B },
        }),
      ).rejects.toBeInstanceOf(TenantMismatchError);
      // An explicit where on B's row finds nothing from A.
      expect(
        await tenantDb(A).invitation.findFirst({ where: { tokenHash: 'token-ws-b' } }),
      ).toBeNull();
      for (const rows of [
        await tenantDb(A).invitation.findMany(),
        await tenantDb(A).inviteLink.findMany(),
        await tenantDb(A).guardianLink.findMany(),
        await tenantDb(A).invitationImport.findMany(),
      ])
        expect(rows.map((r) => r.workspaceId)).toEqual([A]);
      expect(await systemPrisma().invitation.count({ where: { tokenHash: 'evil' } })).toBe(0);
    });

    it('crossTenantDb accepts a tokenHash / code / consentTokenHash lookup and refuses email or status', async () => {
      const { crossTenantDb } = t();
      await expect(
        crossTenantDb().invitation.findFirst({ where: { tokenHash: 'h' } }),
      ).resolves.toBeNull();
      await expect(
        crossTenantDb().inviteLink.findFirst({ where: { code: 'ABCD2345' } }),
      ).resolves.toBeNull();
      // A secret column resolves the row of any workspace (the public route then writes under
      // withTenantTx(row.workspaceId)).
      expect(
        await crossTenantDb().invitation.findUnique({ where: { tokenHash: 'token-ws-b' } }),
      ).toMatchObject({ workspaceId: B, id: invitationOf[B] });
      expect(
        await crossTenantDb().inviteLink.findUnique({ where: { code: 'CODEAAAA' } }),
      ).toMatchObject({ workspaceId: A });
      expect(
        await crossTenantDb().guardianLink.findFirst({
          where: { consentTokenHash: 'consent-ws-b' },
        }),
      ).toMatchObject({ workspaceId: B, studentUserId: u.id });
      expect(
        await crossTenantDb().guardianLink.findUnique({
          where: { sessionsViewTokenHash: 'view-ws-a' },
        }),
      ).toMatchObject({ workspaceId: A });
      // userId / id keep working on the new models.
      expect(
        await crossTenantDb().invitation.findUnique({ where: { id: invitationOf[A] } }),
      ).toMatchObject({ workspaceId: A });

      await expect(
        crossTenantDb().invitation.findFirst({ where: { email: 'a@b.c' } }),
      ).rejects.toThrow(/tokenHash/);
      await expect(
        crossTenantDb().invitation.findFirst({ where: { email: 'invitee@example.com' } }),
      ).rejects.toBeInstanceOf(CrossTenantFilterMissingError);
      await expect(
        crossTenantDb().guardianLink.findMany({ where: { status: 'PENDING' } }),
      ).rejects.toThrow(/consentTokenHash/);
      await expect(
        crossTenantDb().guardianLink.findMany({ where: { guardianEmail: 'parent@example.com' } }),
      ).rejects.toThrow(/sessionsViewTokenHash/);
      await expect(
        crossTenantDb().inviteLink.findMany({ where: { status: 'ACTIVE' } }),
      ).rejects.toThrow(/code/);
      // Only a plain string equality on a secret column counts: no object filters, no empty value.
      for (const where of [
        { tokenHash: { contains: 'token' } },
        { tokenHash: { startsWith: 'token-' } },
        { tokenHash: { in: ['token-ws-a', 'token-ws-b'] } },
        { tokenHash: { not: 'x' } },
        { tokenHash: '' },
        { OR: [{ tokenHash: 'token-ws-a' }, { email: 'invitee@example.com' }] },
      ]) {
        await expect(crossTenantDb().invitation.findMany({ where })).rejects.toBeInstanceOf(
          CrossTenantFilterMissingError,
        );
      }
      await expect(
        crossTenantDb().inviteLink.findMany({ where: { code: { contains: 'CODE' } } }),
      ).rejects.toBeInstanceOf(CrossTenantFilterMissingError);
      // GuardianLink.studentUserId is the data subject's id: a user-scoped filter like userId
      // (string, equals, non-empty in), on GuardianLink only.
      expect(
        (await crossTenantDb().guardianLink.findMany({ where: { studentUserId: u.id } }))
          .map((l) => l.workspaceId)
          .sort(),
      ).toEqual([A, B].sort());
      expect(
        await crossTenantDb().guardianLink.count({ where: { studentUserId: { equals: u.id } } }),
      ).toBe(2);
      expect(
        await crossTenantDb().guardianLink.count({ where: { studentUserId: { in: [u.id] } } }),
      ).toBe(2);
      for (const studentUserId of [{ not: u.id }, { in: [] }, { contains: 'x' }]) {
        await expect(
          crossTenantDb().guardianLink.findMany({ where: { studentUserId } as never }),
        ).rejects.toBeInstanceOf(CrossTenantFilterMissingError);
      }
      await expect(
        crossTenantDb().guardianLink.findMany({ where: { status: 'ACTIVE' } }),
      ).rejects.toThrow(/studentUserId/);
      await expect(
        crossTenantDb().membership.findMany({ where: { studentUserId: u.id } as never }),
      ).rejects.toBeInstanceOf(CrossTenantFilterMissingError);
      // A model without lookup keys accepts only userId / id, and the message says so.
      await expect(
        crossTenantDb().invitationImport.findMany({ where: { workspaceId: B } }),
      ).rejects.toThrow(/userId, id\b/);
      // A lookup key of another model is not a lookup key here.
      await expect(
        crossTenantDb().membership.findMany({ where: { workspaceId: A } }),
      ).rejects.toBeInstanceOf(CrossTenantFilterMissingError);
    });

    it('crossTenantDb({ super_admin }) checks the actor, audits, and allows unfiltered reads only', async () => {
      const { crossTenantDb } = t();
      expect(() =>
        crossTenantDb({ reason: 'super_admin', actor: { userId: 'x', requestId: 'r' } }),
      ).toThrow(TypeError);
      await expect(
        crossTenantDb({
          reason: 'super_admin',
          actor: { userId: u.id, requestId: 'r' },
        }).membership.count(),
      ).rejects.toThrow(/not an active SUPER_ADMIN/);
      const groups = await crossTenantDb(superAdmin()).membership.groupBy({
        by: ['workspaceId'],
        _count: true,
        orderBy: { workspaceId: 'asc' },
      });
      expect(groups.map((g) => g._count)).toEqual([1, 1]);
      const audit = await systemPrisma().auditLog.findMany({
        where: { action: CROSS_TENANT_AUDIT_ACTION },
      });
      expect(audit).toEqual([
        expect.objectContaining({
          actorUserId: admin.id,
          actorRole: 'SUPER_ADMIN',
          entityType: 'Membership',
          requestId: 'req-1',
          after: { operation: 'groupBy' },
          before: null,
        }),
      ]);
      await expect(
        crossTenantDb(superAdmin()).membership.deleteMany({ where: { userId: u.id } }),
      ).rejects.toBeInstanceOf(CrossTenantOperationError);
    });

    it('withTenantTx scopes reads, rejects other tenants and rolls back atomically', async () => {
      const { withTenantTx } = t();
      const seen = await withTenantTx(A, async (tx) => {
        const [{ n }] = await tx.$queryRaw<
          [{ n: number }]
        >`SELECT count(*)::int AS n FROM membership`;
        return { n, rows: await tx.membership.findMany({ where: { workspaceId: B } }) };
      });
      expect(seen).toEqual({ n: rls ? 1 : 2, rows: [] });
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

    it('withTenantTx(preGeneratedId) creates a workspace and its OWNER membership atomically', async () => {
      const { withTenantTx } = t();
      const id = uuidv7();
      const data = {
        id,
        type: 'ORGANIZATION' as const,
        name: 'New',
        slug: `new-${id.slice(-6)}`,
        ownerUserId: other.id,
        defaultTimezone: 'Africa/Tunis',
        defaultLocale: 'fr' as const,
        storageQuotaBytes: 1n,
        settings: {},
      };
      await withTenantTx(id, async (tx) => {
        await tx.workspace.create({ data });
        await tx.membership.create({
          data: { userId: other.id, role: 'OWNER', status: 'ACTIVE' } as never,
        });
      });
      expect(await systemPrisma().membership.findMany({ where: { workspaceId: id } })).toEqual([
        expect.objectContaining({ userId: other.id, role: 'OWNER' }),
      ]);
      const id2 = uuidv7();
      await expect(
        withTenantTx(id2, async (tx) => {
          await tx.workspace.create({ data: { ...data, id: id2, slug: `new-${id2.slice(-6)}` } });
          throw new Error('owner step failed');
        }),
      ).rejects.toThrow('owner step failed');
      expect(await systemPrisma().workspace.findUnique({ where: { id: id2 } })).toBeNull();
    });
  });

  describe('crossTenantDb refused shapes (checked before any DB access)', () => {
    // An unreachable database: any query that got past the extension would fail with a
    // connection error instead of the expected refusal.
    let unreachable: PrismaClient | undefined;
    const offline = bindTenancy(() => {
      if (!unreachable) {
        unreachable = createPrismaClient(
          'postgresql://nobody:x@127.0.0.1:1/none?connect_timeout=1',
        );
        clients.push(unreachable);
      }
      return unreachable;
    });
    const refused = (p: Promise<unknown>) =>
      expect(p).rejects.toBeInstanceOf(CrossTenantOperationError);

    it('refuses every write', async () => {
      const c = offline.crossTenantDb();
      await refused(c.membership.update({ where: { id: memberA }, data: { workspaceId: B } }));
      await refused(c.membership.updateMany({ where: { userId: u.id }, data: { canTeach: true } }));
      await refused(c.membership.deleteMany({ where: { userId: u.id } }));
      await refused(c.membership.delete({ where: { id: memberA } }));
      await refused(
        c.membership.create({
          data: { workspaceId: A, userId: other.id, role: 'STUDENT', status: 'ACTIVE' },
        }),
      );
      await refused(
        c.membership.upsert({
          where: { id: memberA },
          create: { workspaceId: B, userId: other.id, role: 'STUDENT', status: 'ACTIVE' },
          update: {},
        }),
      );
      await refused(c.user.update({ where: { id: u.id }, data: { firstName: 'x' } }));
      await refused(c.consent.updateMany({ where: { userId: u.id }, data: { revokedAt: null } }));
      await refused(
        offline
          .crossTenantDb({ reason: 'super_admin', actor: { userId: u.id, requestId: 'r' } })
          .membership.deleteMany(),
      );
    });

    it('refuses include/select/_count that reach a tenant relation', async () => {
      const c = offline.crossTenantDb();
      await refused(
        c.membership.findMany({
          where: { userId: u.id },
          include: { workspace: { include: { memberships: { include: { user: true } } } } },
        }),
      );
      await refused(
        c.membership.findMany({
          where: { userId: u.id },
          select: { workspace: { select: { _count: { select: { memberships: true } } } } },
        }),
      );
      await refused(c.workspace.findMany({ include: { _count: true } }));
      await refused(c.user.findUnique({ where: { id: u.id }, include: { memberships: true } }));
      await refused(c.user.findUnique({ where: { id: u.id }, select: { consents: true } }));
      await refused(
        c.user.findUnique({ where: { id: u.id }, include: { studentGuardianLinks: true } }),
      );
      await refused(
        c.guardianLink.findFirst({
          where: { consentTokenHash: 'consent-ws-a' },
          include: { consent: true },
        }),
      );
      await refused(
        c.invitation.update({ where: { tokenHash: 'x' }, data: { status: 'REVOKED' } }),
      );
    });
  });

  it('onPrismaLog forwards error events of the app_user client', async () => {
    const seen: { level: string; message: string }[] = [];
    onPrismaLog((level, e) => seen.push({ level, message: e.message }));
    await expect(db.$queryRaw`SELECT * FROM no_such_table`).rejects.toThrow();
    expect(seen.some((e) => e.level === 'error')).toBe(true);
  });
});
