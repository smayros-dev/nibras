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

/**
 * BullMQ's own checks on a custom `jobId` (`Job.validateOptions`, bullmq 5): not an integer, and
 * either no `:` or exactly three `:`-separated parts. Mirrored by the fake so a job id the real
 * queue would refuse fails the API tests too (SP2 T15: `import:{id}` passed them and 500ed live).
 */
export function assertBullmqJobId(jobId: string | undefined): void {
  if (jobId === undefined) return;
  if (`${parseInt(jobId, 10)}` === jobId) throw new Error('Custom Id cannot be integers');
  if (jobId.includes(':') && jobId.split(':').length !== 3) {
    throw new Error('Custom Id cannot contain :');
  }
}

/** Test double: records jobs instead of enqueueing them (job ids checked like BullMQ does). */
export class FakeQueueService implements Pick<QueueService, 'add'> {
  readonly jobs: RecordedJob[] = [];

  add(queue: QueueName, name: string, data: unknown, opts?: JobsOptions): Promise<void> {
    try {
      assertBullmqJobId(opts?.jobId);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    this.jobs.push({ queue, name, data, ...(opts !== undefined && { opts }) });
    return Promise.resolve();
  }

  clear(): void {
    this.jobs.length = 0;
  }
}
