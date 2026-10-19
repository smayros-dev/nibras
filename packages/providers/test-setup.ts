import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyTestEnv } from '@nibras/config/vitest/test-env';

// Load the monorepo root `.env` when present (already-set variables win), then derive this
// package's own MinIO bucket from S3_BUCKET_TEST (`nibras-test` -> `nibras-providers-test`; see
// @nibras/config/vitest/test-env). Without S3_ENDPOINT the S3 suite is skipped.
const rootEnv = resolve(__dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
applyTestEnv('providers', process.env);
