import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyTestEnv } from '@tt/config/vitest/test-env';

// Load the monorepo root `.env` (already-set variables win, e.g. CI secrets),
// derive this package's own test database and Redis index (`tt_api_test`, DB 14 by default; see
// @tt/config/vitest/test-env), then point the API at them and mark the process as `test`.
const rootEnv = resolve(__dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
applyTestEnv('api', process.env);
if (process.env.DATABASE_URL_TEST) process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
if (process.env.DATABASE_URL_TEST_SYSTEM) {
  process.env.DATABASE_URL_SYSTEM = process.env.DATABASE_URL_TEST_SYSTEM;
}
if (process.env.REDIS_URL_TEST) process.env.REDIS_URL = process.env.REDIS_URL_TEST;
process.env.NODE_ENV = 'test';
// Specs capture logs in memory (see helpers/app.ts) and assert on debug lines.
process.env.LOG_LEVEL = 'debug';
// A developer `.env` must not turn tracing on (and export spans) during tests.
delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
