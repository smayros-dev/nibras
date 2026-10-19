import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import {
  DAILY_SCHEDULER_PATTERN,
  DEFAULT_JOB_OPTIONS,
  GUARDIAN_CONSENT_EXPIRE_JOB,
  GUARDIAN_CONSENT_EXPIRE_SCHEDULER_ID,
  INVITATION_EXPIRE_JOB,
  INVITATION_EXPIRE_SCHEDULER_ID,
  QUEUES,
  type QueueName,
} from '@nibras/contracts';
import type { Logger } from 'pino';

import { WORKER_LOGGER } from './logger';
import { QueueRegistry } from './queues';

export interface SchedulerDefinition {
  id: string;
  queue: QueueName;
  jobName: string;
}

/** The repeatable jobs the worker owns: daily at `DAILY_SCHEDULER_PATTERN` (03:00 UTC). */
export const SCHEDULERS: readonly SchedulerDefinition[] = [
  {
    id: GUARDIAN_CONSENT_EXPIRE_SCHEDULER_ID,
    queue: QUEUES.compliance,
    jobName: GUARDIAN_CONSENT_EXPIRE_JOB,
  },
  { id: INVITATION_EXPIRE_SCHEDULER_ID, queue: QUEUES.compliance, jobName: INVITATION_EXPIRE_JOB },
];

/**
 * Registers `SCHEDULERS` with BullMQ job schedulers on bootstrap. `upsertJobScheduler` is
 * idempotent by id: a restart (or several worker replicas) updates the same scheduler and never
 * adds a second occurrence. Each occurrence runs with the default attempts and backoff.
 *
 * The upserts run in the background (`ready`): with Redis unreachable they wait for the
 * connection instead of blocking the boot, so the health server still answers (`/health/ready`
 * 503). A failure is logged, never thrown.
 */
@Injectable()
export class Schedulers implements OnApplicationBootstrap {
  /** Settles once every scheduler was upserted (or the attempt failed and was logged). */
  ready: Promise<void> = Promise.resolve();

  constructor(
    private readonly registry: QueueRegistry,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    this.ready = this.upsertAll();
  }

  private async upsertAll(): Promise<void> {
    for (const s of SCHEDULERS) {
      try {
        const queue = this.registry.queues.get(s.queue);
        if (!queue) throw new Error(`unknown queue ${s.queue}`);
        await queue.upsertJobScheduler(
          s.id,
          { pattern: DAILY_SCHEDULER_PATTERN, tz: 'UTC' },
          { name: s.jobName, data: {}, opts: { ...DEFAULT_JOB_OPTIONS } },
        );
        this.logger.info(
          { queue: s.queue, scheduler_id: s.id, pattern: DAILY_SCHEDULER_PATTERN },
          `job scheduler upserted ${s.id}`,
        );
      } catch (err) {
        this.logger.error(
          { queue: s.queue, scheduler_id: s.id, err },
          'job scheduler not upserted',
        );
      }
    }
  }
}
