/**
 * Per-package test isolation. Turbo runs the `@tt/db`, `@tt/api` and `@tt/worker` test tasks in
 * parallel, so each package gets its own Postgres database and Redis DB index, derived from the
 * shared base variables (`DATABASE_URL_TEST`, `DATABASE_URL_TEST_SYSTEM`, `REDIS_URL_TEST`):
 * the database name becomes `tt_<pkg>_test`, the Redis path `/<index>`.
 * `packages/db/scripts/migrate-test.mjs` applies the same rule (plain Node, it cannot import this).
 */
export type TestPackage = 'db' | 'api' | 'worker';

export const TEST_PACKAGES: readonly TestPackage[] = ['db', 'api', 'worker'];

/** Redis DB index per package; never 0 (the development DB). */
export const TEST_REDIS_DB: Record<TestPackage, number> = { db: 13, api: 14, worker: 15 };

/** `postgresql://u:p@h:5432/tt_test?x=y` -> `postgresql://u:p@h:5432/tt_<pkg>_test?x=y`. */
export function testDatabaseUrl(base: string, pkg: TestPackage): string {
  const url = new URL(base);
  url.pathname = `/tt_${pkg}_test`;
  return url.toString();
}

/** `redis://h:6379/15` -> `redis://h:6379/<TEST_REDIS_DB[pkg]>`. */
export function testRedisUrl(base: string, pkg: TestPackage): string {
  const url = new URL(base);
  url.pathname = `/${TEST_REDIS_DB[pkg]}`;
  return url.toString();
}

/**
 * Rewrites the base test variables of `env` (when set) to this package's own database and Redis
 * index. Call it from the package's Vitest setup file (with `process.env`), after loading the
 * root `.env`.
 */
export function applyTestEnv(pkg: TestPackage, env: Record<string, string | undefined>): void {
  if (env.DATABASE_URL_TEST) env.DATABASE_URL_TEST = testDatabaseUrl(env.DATABASE_URL_TEST, pkg);
  if (env.DATABASE_URL_TEST_SYSTEM) {
    env.DATABASE_URL_TEST_SYSTEM = testDatabaseUrl(env.DATABASE_URL_TEST_SYSTEM, pkg);
  }
  if (env.REDIS_URL_TEST) env.REDIS_URL_TEST = testRedisUrl(env.REDIS_URL_TEST, pkg);
}
