import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createWorkerContext } from './worker.module';

// Local dev: load the monorepo root `.env` (already-set variables win).
const rootEnv = resolve(__dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

async function bootstrap(): Promise<void> {
  const ctx = await createWorkerContext();
  // Graceful shutdown: SIGTERM/SIGINT run the Nest hooks (health server, workers, Redis, DB).
  ctx.app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
}

bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
