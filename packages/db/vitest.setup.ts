import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyTestEnv } from '@tt/config/vitest/test-env';

// Load the monorepo root `.env` (already-set variables win), derive this package's own test
// database (`tt_db_test` by default, see @tt/config/vitest/test-env), then point the system client
// and the app_user `DATABASE_URL` (behind `db`/`tenantDb`) at it so both hit `tt_db_test`.
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
applyTestEnv('db', process.env);
if (process.env.DATABASE_URL_TEST) process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
if (process.env.DATABASE_URL_TEST_SYSTEM) {
  process.env.DATABASE_URL_SYSTEM = process.env.DATABASE_URL_TEST_SYSTEM;
}
