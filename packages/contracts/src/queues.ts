/** BullMQ queue names (PRD §13.5). */
export const QUEUES = {
  sessions: 'sessions',
  notifications: 'notifications',
  media: 'media',
  imports: 'imports',
  compliance: 'compliance',
  analytics: 'analytics',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Job options every producer (API, worker) uses when enqueueing, structurally compatible with
 * BullMQ's `JobsOptions` (contracts does not depend on BullMQ).
 */
export interface DefaultJobOptions {
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  /** Completed/failed jobs kept in Redis (count), for inspection. */
  removeOnComplete: number;
  removeOnFail: number;
}

export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};
