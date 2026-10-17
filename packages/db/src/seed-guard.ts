/**
 * Guard for the local demo seed (`prisma/seed.ts`); not exported from the package entry.
 *
 * Only loopback database hosts are allowed by default. The compose service name `postgres` is
 * deliberately not on the list: staging uses the same host name and its `.env` may still say
 * `APP_ENV=development`. Any other host needs `SEED_ALLOW_HOST` set to that exact host name.
 */
const LOOPBACK_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Why the seed must not run in this environment, or `null` when it may. */
export function seedRefusal(env: Readonly<Record<string, string | undefined>>): string | null {
  const appEnv = env.APP_ENV;
  if (appEnv !== undefined && appEnv !== '' && appEnv !== 'development') {
    return `APP_ENV=${appEnv} (only unset or "development" is allowed)`;
  }
  if (env.NODE_ENV === 'production') return 'NODE_ENV=production';
  const url = env.DATABASE_URL_SYSTEM;
  if (!url) return 'DATABASE_URL_SYSTEM is not set';
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'DATABASE_URL_SYSTEM is not a valid URL';
  }
  if (LOOPBACK_DB_HOSTS.has(host)) return null;
  const allowed = env.SEED_ALLOW_HOST?.trim().toLowerCase();
  if (!allowed) {
    return (
      `DATABASE_URL_SYSTEM host "${host}" is not local (localhost, 127.0.0.1, ::1); ` +
      `set SEED_ALLOW_HOST=${host} to seed it on purpose`
    );
  }
  if (allowed !== host) {
    return `SEED_ALLOW_HOST="${allowed}" does not match host "${host}" of DATABASE_URL_SYSTEM`;
  }
  return null;
}
