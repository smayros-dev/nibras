import { PrismaClient } from '@prisma/client';

/**
 * Creates a Prisma client on `url` (defaults to `DATABASE_URL`, the RLS-bound `app_user` role).
 * Logs are emitted as events so callers can forward them to pino.
 */
export function createPrismaClient(
  url: string | undefined = process.env.DATABASE_URL,
): PrismaClient {
  if (!url) throw new Error('createPrismaClient: no database URL (set DATABASE_URL)');
  return new PrismaClient({
    datasources: { db: { url } },
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });
}

let system: PrismaClient | undefined;

/** Singleton client on `DATABASE_URL_SYSTEM` (`app_system`, BYPASSRLS): worker, migrations, test resets. */
export function systemPrisma(): PrismaClient {
  system ??= createPrismaClient(process.env.DATABASE_URL_SYSTEM ?? missing('DATABASE_URL_SYSTEM'));
  return system;
}

function missing(name: string): never {
  throw new Error(`systemPrisma: ${name} is not set`);
}
