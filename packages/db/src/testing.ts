import type { PrismaClient } from '@prisma/client';
import { systemPrisma } from './client';

/** Empties every table in `public` (except `_prisma_migrations`) in one TRUNCATE. Tests only. */
export async function resetDatabase(client: PrismaClient = systemPrisma()): Promise<void> {
  const tables = await client.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables
    .map(({ tablename }) => `"public"."${tablename.replace(/"/g, '""')}"`)
    .join(', ');
  await client.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
