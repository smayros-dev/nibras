import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load the monorepo root `.env` (already-set variables win, e.g. CI secrets),
// then point the API at the test database and Redis index and mark the process as `test`.
const rootEnv = resolve(__dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
if (process.env.DATABASE_URL_TEST) process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
if (process.env.DATABASE_URL_TEST_SYSTEM) {
  process.env.DATABASE_URL_SYSTEM = process.env.DATABASE_URL_TEST_SYSTEM;
}
if (process.env.REDIS_URL_TEST) process.env.REDIS_URL = process.env.REDIS_URL_TEST;
process.env.NODE_ENV = 'test';
