import { Inject, Injectable } from '@nestjs/common';
import type { QueueName } from '@nibras/contracts';
import type { JobsOptions, Queue } from 'bullmq';

/** Injection token for the `QueueName → Queue` map built by `QueueModule`. */
export const QUEUES_BY_NAME = Symbol('QUEUES_BY_NAME');

/**
 * Enqueues jobs for the worker on the BullMQ queues of `QUEUES` (each with `DEFAULT_JOB_OPTIONS`;
 * `opts` overrides them per job, e.g. `delay`, `jobId`). Job payloads carry ids, never secrets:
 * the worker logs them.
 */
@Injectable()
export class QueueService {
  constructor(@Inject(QUEUES_BY_NAME) private readonly queues: ReadonlyMap<QueueName, Queue>) {}

  async add(queue: QueueName, name: string, data: unknown, opts?: JobsOptions): Promise<void> {
    const target = this.queues.get(queue);
    if (!target) throw new Error(`QueueService: unknown queue "${queue}"`);
    await target.add(name, data, opts);
  }
}

/** A job recorded by {@link FakeQueueService}. */
export interface RecordedJob {
  queue: QueueName;
  name: string;
  data: unknown;
  opts?: JobsOptions;
}

/** Test double: records jobs instead of enqueueing them. */
export class FakeQueueService implements Pick<QueueService, 'add'> {
  readonly jobs: RecordedJob[] = [];

  add(queue: QueueName, name: string, data: unknown, opts?: JobsOptions): Promise<void> {
    this.jobs.push({ queue, name, data, ...(opts !== undefined && { opts }) });
    return Promise.resolve();
  }

  clear(): void {
    this.jobs.length = 0;
  }
}
