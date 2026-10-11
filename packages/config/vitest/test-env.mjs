/**
 * Per-package test isolation. Turbo runs the `@tt/db`, `@tt/api` and `@tt/worker` test tasks in
 * parallel, so each package gets its own Postgres database and Redis DB index, derived from the
 * shared base variables (`DATABASE_URL_TEST`, `DATABASE_URL_TEST_SYSTEM`, `REDIS_URL_TEST`):
 * the database name becomes `<TEST_DB_PREFIX>_<pkg>_test` (prefix `tt` by default), the Redis path
 * `/<TEST_REDIS_DB_BASE + offset>` (base 13 by default: db 13, api 14, worker 15).
 *
 * The two knobs let parallel git worktrees share one Postgres/Redis without colliding (e.g.
 * `TEST_DB_PREFIX=tt_t1`, `TEST_REDIS_DB_BASE=10`). Plain ESM (types in `test-env.d.mts`) so
 * `packages/db/scripts/migrate-test.mjs` imports this same file with Node alone.
 */

/** @type {readonly import('./test-env.d.mts').TestPackage[]} */
export const TEST_PACKAGES = ['db', 'api', 'worker'];

const REDIS_DB_OFFSET = { db: 0, api: 1, worker: 2 };

const DB_PREFIX = /^[a-z_][a-z0-9_]*$/;

/**
 * `<TEST_DB_PREFIX ?? 'tt'>_<pkg>_test`. A set prefix (even empty) must match
 * `/^[a-z_][a-z0-9_]*$/` (an unquoted lower-case Postgres identifier), else this throws.
 */
export function testDbName(pkg, env = process.env) {
  const prefix = env.TEST_DB_PREFIX ?? 'tt';
  if (!DB_PREFIX.test(prefix)) {
    throw new Error(`TEST_DB_PREFIX must match ${DB_PREFIX}, got "${prefix}"`);
  }
  return `${prefix}_${pkg}_test`;
}

/**
 * `TEST_REDIS_DB_BASE` (default 13) + 0/1/2 for db/api/worker. The base must be an integer in
 * 1..13 so the three indexes stay within Redis' 0..15 and never use 0 (the development DB).
 */
export function testRedisDb(pkg, env = process.env) {
  const raw = env.TEST_REDIS_DB_BASE ?? 13;
  const base = Number(raw);
  if (!Number.isInteger(base) || base < 1 || base > 13) {
    throw new Error(`TEST_REDIS_DB_BASE must be an integer from 1 to 13, got "${raw}"`);
  }
  return base + REDIS_DB_OFFSET[pkg];
}

/** `postgresql://u:p@h:5432/tt_test?x=y` -> `postgresql://u:p@h:5432/<testDbName(pkg)>?x=y`. */
export function testDatabaseUrl(base, pkg, env = process.env) {
  const url = new URL(base);
  url.pathname = `/${testDbName(pkg, env)}`;
  return url.toString();
}

/** `redis://h:6379/15` -> `redis://h:6379/<testRedisDb(pkg)>`. */
export function testRedisUrl(base, pkg, env = process.env) {
  const url = new URL(base);
  url.pathname = `/${testRedisDb(pkg, env)}`;
  return url.toString();
}

/**
 * Rewrites the base test variables of `env` (when set) to this package's own database and Redis
 * index, honouring `TEST_DB_PREFIX` / `TEST_REDIS_DB_BASE` from the same `env`. Call it from the
 * package's Vitest setup file (with `process.env`), after loading the root `.env`.
 */
export function applyTestEnv(pkg, env) {
  if (env.DATABASE_URL_TEST) {
    env.DATABASE_URL_TEST = testDatabaseUrl(env.DATABASE_URL_TEST, pkg, env);
  }
  if (env.DATABASE_URL_TEST_SYSTEM) {
    env.DATABASE_URL_TEST_SYSTEM = testDatabaseUrl(env.DATABASE_URL_TEST_SYSTEM, pkg, env);
  }
  if (env.REDIS_URL_TEST) env.REDIS_URL_TEST = testRedisUrl(env.REDIS_URL_TEST, pkg, env);
}
