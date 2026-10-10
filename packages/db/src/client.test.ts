import { describe, it, expect } from 'vitest';
import { createPrismaClient, systemPrisma, resetDatabase } from './index';

describe.skipIf(!process.env.DATABASE_URL_TEST)('db client', () => {
  it('connects as app_user without BYPASSRLS', async () => {
    const db = createPrismaClient(process.env.DATABASE_URL_TEST);
    const [row] = await db.$queryRaw<{ rolbypassrls: boolean; rolname: string }[]>`
      SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(row).toEqual({ rolname: 'app_user', rolbypassrls: false });
  });
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
});
