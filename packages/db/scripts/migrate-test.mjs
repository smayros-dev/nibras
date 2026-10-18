// `prisma migrate deploy` against each package's test database (nibras_db_test, nibras_api_test and
// nibras_worker_test, or `<TEST_DB_PREFIX>_<pkg>_test` in a parallel worktree), derived from
// DATABASE_URL_TEST_SYSTEM (app_system) by the same `testDbName` the Vitest setups use.
// Prisma creates a missing database (app_system has CREATEDB), so an older local volume works too.
// A Node wrapper because `$VAR` in a package.json script does not expand under cmd.exe (pnpm's Windows shell).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { TEST_PACKAGES, testDbName } from '@nibras/config/vitest/test-env';

const baseUrl = process.env.DATABASE_URL_TEST_SYSTEM;
if (!baseUrl) {
  console.error('migrate:test: DATABASE_URL_TEST_SYSTEM is not set');
  process.exit(1);
}

const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
for (const pkg of TEST_PACKAGES) {
  const name = testDbName(pkg);
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  console.log(`migrate:test: migrating ${name}`);
  const { status } = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    stdio: 'inherit',
    // The schema's datasource reads DATABASE_URL_SYSTEM.
    env: { ...process.env, DATABASE_URL_SYSTEM: url.toString() },
  });
  if (status !== 0) process.exit(status ?? 1);
}
