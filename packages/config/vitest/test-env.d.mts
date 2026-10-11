/** Types for `test-env.mjs` (plain ESM so `@tt/db`'s `migrate-test.mjs` can import it). */
export type TestPackage = 'db' | 'api' | 'worker';

/** The variables read: `TEST_DB_PREFIX`, `TEST_REDIS_DB_BASE` and the `*_TEST` base URLs. */
type Env = Record<string, string | undefined>;

export declare const TEST_PACKAGES: readonly TestPackage[];

/** `<TEST_DB_PREFIX ?? 'tt'>_<pkg>_test`; throws when a set prefix (even empty) does not match `/^[a-z_][a-z0-9_]*$/`. */
export declare function testDbName(pkg: TestPackage, env?: Env): string;

/** `TEST_REDIS_DB_BASE` (default 13, integer 1..13, else throws) + 0/1/2 for db/api/worker. */
export declare function testRedisDb(pkg: TestPackage, env?: Env): number;

/** Replaces the database name of `base` with `testDbName(pkg, env)`. */
export declare function testDatabaseUrl(base: string, pkg: TestPackage, env?: Env): string;

/** Replaces the DB index of `base` with `testRedisDb(pkg, env)`. */
export declare function testRedisUrl(base: string, pkg: TestPackage, env?: Env): string;

/** Rewrites `env`'s base test variables (when set) to this package's database and Redis index. */
export declare function applyTestEnv(pkg: TestPackage, env: Env): void;
