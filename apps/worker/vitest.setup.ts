import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyTestEnv } from '@tt/config/vitest/test-env';

// Load the monorepo root `.env` (already-set variables win), derive this package's own test
// database and Redis index (`tt_worker_test`, DB 15; see @tt/config/vitest/test-env), then point the
// worker at them, an ephemeral health port and silent logs.
const rootEnv = resolve(__dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
applyTestEnv('worker', process.env);
if (process.env.DATABASE_URL_TEST_SYSTEM) {
  process.env.DATABASE_URL_SYSTEM = process.env.DATABASE_URL_TEST_SYSTEM;
}
if (process.env.REDIS_URL_TEST) {
  process.env.REDIS_URL = process.env.REDIS_URL_TEST;
}
process.env.WORKER_PORT = '0';
process.env.LOG_LEVEL = 'silent';
