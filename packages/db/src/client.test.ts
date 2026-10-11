import { describe, it, expect } from 'vitest';
import { createPrismaClient, systemPrisma, resetDatabase, TRANSACTION_OPTIONS } from './index';

describe.skipIf(!process.env.DATABASE_URL_TEST)('db client', () => {
  it('connects as app_user without BYPASSRLS', async () => {
    const db = createPrismaClient(process.env.DATABASE_URL_TEST);
    const [row] = await db.$queryRaw<{ rolbypassrls: boolean; rolname: string }[]>`
      SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(row).toEqual({ rolname: 'app_user', rolbypassrls: false });
  });
  it('interactive transactions may run past Prisma 5 s default timeout (TRANSACTION_OPTIONS)', async () => {
    expect(TRANSACTION_OPTIONS).toEqual({ maxWait: 5_000, timeout: 10_000 });
    const db = createPrismaClient(process.env.DATABASE_URL_TEST);
    try {
      const result = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_sleep(5.5)`;
        return 'committed';
      });
      expect(result).toBe('committed');
    } finally {
      await db.$disconnect();
    }
  }, 20_000);
  it('system role bypasses RLS and migrations table exists', async () => {
    const [{ rolbypassrls }] = await systemPrisma().$queryRaw<[{ rolbypassrls: boolean }]>`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(rolbypassrls).toBe(true);
    const [{ count }] = await systemPrisma().$queryRaw<[{ count: bigint }]>`
      SELECT count(*)::bigint FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    expect(Number(count)).toBeGreaterThanOrEqual(1);
  });
  it('resetDatabase leaves _prisma_migrations intact', async () => {
    await resetDatabase();
    const [{ count }] = await systemPrisma().$queryRaw<
      [{ count: bigint }]
    >`SELECT count(*)::bigint FROM _prisma_migrations`;
    expect(Number(count)).toBeGreaterThanOrEqual(1);
  });
  it('init migration grants app_user schema USAGE and default table/sequence privileges', async () => {
    const [{ usage }] = await systemPrisma().$queryRaw<[{ usage: boolean }]>`
      SELECT has_schema_privilege('app_user', 'public', 'USAGE') AS usage`;
    expect(usage).toBe(true);
    const acls = await systemPrisma().$queryRaw<{ type: string; acl: string }[]>`
      SELECT d.defaclobjtype::text AS type, d.defaclacl::text AS acl
      FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
      WHERE n.nspname = 'public' AND pg_get_userbyid(d.defaclrole) = 'app_system'
      ORDER BY 1`;
    expect(acls).toEqual([
      { type: 'S', acl: expect.stringContaining('app_user=rU/app_system') },
      { type: 'r', acl: expect.stringContaining('app_user=arwd/app_system') },
    ]);
  });
  it('resetDatabase refuses to run outside a *_test database', async () => {
    const url = new URL(process.env.DATABASE_URL_TEST_SYSTEM ?? '');
    url.pathname = '/postgres';
    const db = createPrismaClient(url.toString());
    try {
      await expect(resetDatabase(db)).rejects.toThrow(/refusing to reset database "postgres"/);
    } finally {
      await db.$disconnect();
    }
  });
});
