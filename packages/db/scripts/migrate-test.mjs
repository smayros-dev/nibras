// `prisma migrate deploy` against each package's test database: tt_db_test, tt_api_test and
// tt_worker_test, derived from DATABASE_URL_TEST_SYSTEM (app_system) by replacing the database name,
// the same rule as @tt/config/vitest/test-env (which this plain Node script cannot import).
// Prisma creates a missing database (app_system has CREATEDB), so an older local volume works too.
// A Node wrapper because `$VAR` in a package.json script does not expand under cmd.exe (pnpm's Windows shell).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const TEST_PACKAGES = ['db', 'api', 'worker'];

const baseUrl = process.env.DATABASE_URL_TEST_SYSTEM;
if (!baseUrl) {
  console.error('migrate:test: DATABASE_URL_TEST_SYSTEM is not set');
  process.exit(1);
}

const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
for (const pkg of TEST_PACKAGES) {
  const url = new URL(baseUrl);
  url.pathname = `/tt_${pkg}_test`;
  console.log(`migrate:test: migrating tt_${pkg}_test`);
  const { status } = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    stdio: 'inherit',
    // The schema's datasource reads DATABASE_URL_SYSTEM.
    env: { ...process.env, DATABASE_URL_SYSTEM: url.toString() },
  });
  if (status !== 0) process.exit(status ?? 1);
}
