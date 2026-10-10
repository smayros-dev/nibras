import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { HealthServer } from '../src/health-server';
import { createWorkerContext, type WorkerContext } from '../src/worker.module';
import { obliterateAllQueues } from './redis';

async function status(ctx: WorkerContext, path: string): Promise<number> {
  const port = ctx.app.get(HealthServer).port();
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  await res.body?.cancel();
  return res.status;
}

/** Polls `path` until it answers `expected` (readiness settles once Redis connects). */
async function eventually(ctx: WorkerContext, path: string, expected: number): Promise<number> {
  const deadline = Date.now() + 5_000;
  let last = await status(ctx, path);
  while (last !== expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    last = await status(ctx, path);
  }
  return last;
}

describe('health server', () => {
  const contexts: WorkerContext[] = [];
  const redisUrl = process.env.REDIS_URL;

  afterEach(async () => {
    process.env.REDIS_URL = redisUrl;
    await Promise.all(contexts.splice(0).map((c) => c.close()));
  });

  afterAll(() => obliterateAllQueues());

  it('answers live 200 and ready 200 when redis is reachable', async () => {
    const ctx = await createWorkerContext();
    contexts.push(ctx);
    expect(await status(ctx, '/health/live')).toBe(200);
    expect(await eventually(ctx, '/health/ready', 200)).toBe(200);
    expect(await status(ctx, '/health/nope')).toBe(404);
  });

  it('answers live 200 but ready 503 when redis is down', async () => {
    process.env.REDIS_URL = 'redis://localhost:1';
    const ctx = await createWorkerContext();
    contexts.push(ctx);
    expect(await status(ctx, '/health/live')).toBe(200);
    expect(await status(ctx, '/health/ready')).toBe(503);
  });
});
