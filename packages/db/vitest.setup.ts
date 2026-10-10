import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load the monorepo root `.env` (already-set variables win), then point the
// system client at the test database so `systemPrisma()` hits `tt_test`.
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
if (process.env.DATABASE_URL_TEST_SYSTEM) {
  process.env.DATABASE_URL_SYSTEM = process.env.DATABASE_URL_TEST_SYSTEM;
}
