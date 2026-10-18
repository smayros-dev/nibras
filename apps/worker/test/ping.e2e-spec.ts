import { DEFAULT_JOB_OPTIONS, QUEUES } from '@nibras/contracts';
import { Queue, QueueEvents } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWorkerContext, type WorkerContext } from '../src/worker.module';
import { obliterateAllQueues, redisOpts } from './redis';

describe('compliance queue round-trip', () => {
  let ctx: WorkerContext;
  let queue: Queue;
  let events: QueueEvents;

  beforeAll(async () => {
    await obliterateAllQueues();
    queue = new Queue(QUEUES.compliance, { connection: redisOpts });
    events = new QueueEvents(QUEUES.compliance, { connection: redisOpts });
    await events.waitUntilReady();
    ctx = await createWorkerContext();
  });

  afterAll(async () => {
    await ctx?.close();
    await events?.close();
    await queue?.close();
    await obliterateAllQueues();
  });

  it('processes system.ping on the compliance queue', async () => {
    const job = await queue.add('system.ping', { msg: 'hi' });
    await expect(job.waitUntilFinished(events, 10_000)).resolves.toEqual({ pong: 'hi' });
  });

  it('fails unknown job names without retrying', async () => {
    // Retryable options: only an unrecoverable error stops after the first attempt.
    const job = await queue.add('nope.job', {}, DEFAULT_JOB_OPTIONS);
    await expect(job.waitUntilFinished(events, 10_000)).rejects.toThrow(/UnknownJob/);
    const failed = await queue.getJob(job.id!);
    expect(failed?.attemptsMade).toBe(1);
  });
});
