/** Types for `test-env.mjs` (plain ESM so `@nibras/db`'s `migrate-test.mjs` can import it). */
/** Packages with a test database and Redis index. */
export type DbTestPackage = 'db' | 'api' | 'worker';
/** Every package with per-package test resources (`providers`: an S3 bucket only). */
export type TestPackage = DbTestPackage | 'providers';

/** The variables read: `TEST_DB_PREFIX`, `TEST_REDIS_DB_BASE`, `S3_BUCKET_TEST` and the `*_TEST` base URLs. */
type Env = Record<string, string | undefined>;

/** The packages with a test database (`pnpm db:migrate:test`). */
export declare const TEST_PACKAGES: readonly DbTestPackage[];

/** `<TEST_DB_PREFIX ?? 'nibras'>_<pkg>_test`; throws when a set prefix (even empty) does not match `/^[a-z_][a-z0-9_]*$/`. */
export declare function testDbName(pkg: TestPackage, env?: Env): string;

/** `TEST_REDIS_DB_BASE` (default 13, integer 1..13, else throws) + 0/1/2 for db/api/worker; throws for `providers`. */
export declare function testRedisDb(pkg: TestPackage, env?: Env): number;

/** `S3_BUCKET_TEST` (default `nibras-test`) with `-<pkg>` inserted before a trailing `-test` (else appended); throws on an invalid bucket name. */
export declare function testBucketName(pkg: TestPackage, env?: Env): string;

/** Replaces the database name of `base` with `testDbName(pkg, env)`. */
export declare function testDatabaseUrl(base: string, pkg: TestPackage, env?: Env): string;

/** Replaces the DB index of `base` with `testRedisDb(pkg, env)`. */
export declare function testRedisUrl(base: string, pkg: TestPackage, env?: Env): string;

/** Rewrites `env`'s base test variables (when set) to this package's database, Redis index and S3 bucket (`providers`: the bucket only). */
export declare function applyTestEnv(pkg: TestPackage, env: Env): void;
