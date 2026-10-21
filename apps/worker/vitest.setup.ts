import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyTestEnv } from '@nibras/config/vitest/test-env';

// Load the monorepo root `.env` (already-set variables win), derive this package's own test
// database and Redis index (`nibras_worker_test`, DB 15 by default; see @nibras/config/vitest/test-env), then point the
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
// This package's own bucket (`nibras-worker-test`, derived from the S3_BUCKET_TEST base).
if (process.env.S3_BUCKET_TEST) {
  process.env.S3_BUCKET = process.env.S3_BUCKET_TEST;
}
process.env.WORKER_PORT = '0';
process.env.LOG_LEVEL = 'silent';
