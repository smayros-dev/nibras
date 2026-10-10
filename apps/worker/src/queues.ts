import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { QUEUES, type QueueName } from '@tt/contracts';
import { type Job, Queue, type RedisOptions, UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';

import { WORKER_ENV, type WorkerEnv } from './env';
import { WORKER_LOGGER } from './logger';

export const WORKER_CONCURRENCY = 5;

export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/** Parses `REDIS_URL` into BullMQ connection options, keeping the DB index (`/8`). */
export function redisConnection(url: string | undefined): RedisOptions {
  if (!url) throw new Error('redisConnection: REDIS_URL is not set');
  const u = new URL(url);
  const db = Number(u.pathname.replace(/^\//, '') || 0);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    db: Number.isInteger(db) ? db : 0,
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    // Required by BullMQ workers: blocking commands must not be retried per request.
    maxRetriesPerRequest: null,
  };
}

/** Thrown for a job name no processor registered; unrecoverable, so never retried. */
export class UnknownJobError extends UnrecoverableError {
  constructor(queue: QueueName, jobName: string) {
    super(`UnknownJobError: no processor for job "${jobName}" on queue "${queue}"`);
    this.name = 'UnknownJobError';
  }
}

export type JobHandler = (job: Job) => Promise<unknown>;

/** Routes each job to the handler registered for its queue and `job.name`. */
@Injectable()
export class ProcessorRegistry {
  private readonly handlers = new Map<QueueName, Map<string, JobHandler>>();

  registerProcessor(queue: QueueName, jobName: string, handler: JobHandler): void {
    const byName = this.handlers.get(queue) ?? new Map<string, JobHandler>();
    if (byName.has(jobName)) throw new Error(`Processor already registered: ${queue}/${jobName}`);
    byName.set(jobName, handler);
    this.handlers.set(queue, byName);
  }

  async dispatch(queue: QueueName, job: Job): Promise<unknown> {
    const handler = this.handlers.get(queue)?.get(job.name);
    if (!handler) throw new UnknownJobError(queue, job.name);
    return handler(job);
  }
}

/**
 * Owns one BullMQ `Queue` and `Worker` per name in `QUEUES`, plus a Redis client for readiness.
 * Workers start once every module registered its processors (`onModuleInit`);
 * shutdown closes the workers (active jobs finish) and then the Redis connections.
 */
@Injectable()
export class QueueRegistry implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly queues = new Map<QueueName, Queue>();
  readonly workers = new Map<QueueName, Worker>();
  private readonly connection: RedisOptions;
  private readonly redis: Redis;

  constructor(
    @Inject(WORKER_ENV) env: WorkerEnv,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
    private readonly processors: ProcessorRegistry,
  ) {
    this.connection = redisConnection(env.REDIS_URL);
    // Readiness client: fail fast instead of queueing commands while disconnected.
    this.redis = new Redis({
      ...this.connection,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    this.redis.on('error', (err: Error) => this.onError('redis', err));
    for (const name of Object.values(QUEUES)) {
      const queue = new Queue(name, {
        connection: this.connection,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      queue.on('error', (err) => this.onError(name, err));
      this.queues.set(name, queue);
    }
  }

  onApplicationBootstrap(): void {
    for (const name of Object.values(QUEUES)) {
      const worker = new Worker(name, (job) => this.process(name, job), {
        connection: this.connection,
        concurrency: WORKER_CONCURRENCY,
      });
      worker.on('error', (err) => this.onError(name, err));
      worker.on('failed', (job, err) => {
        this.logger.warn({ queue: name, job_id: job?.id, job_name: job?.name, err }, 'job failed');
      });
      this.workers.set(name, worker);
    }
  }

  /** Ready when Redis answers `PING` (within `timeoutMs`) and every worker is running. */
  async isReady(timeoutMs = 1000): Promise<boolean> {
    const workers = [...this.workers.values()];
    if (workers.length === 0 || workers.some((w) => !w.isRunning())) return false;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const ping = this.redis.ping().then(
      (reply) => reply === 'PONG',
      () => false,
    );
    try {
      return await Promise.race([ping, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    // Workers first (active jobs finish), then the queues' and readiness Redis connections.
    await Promise.allSettled([...this.workers.values()].map((w) => w.close()));
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    this.redis.disconnect();
    this.workers.clear();
    this.queues.clear();
  }

  private async process(queue: QueueName, job: Job): Promise<unknown> {
    const data: unknown = job.data;
    const workspaceId =
      data && typeof data === 'object' && 'workspaceId' in data ? data.workspaceId : null;
    // PRD §13.3: the worker bypasses RLS, so every job logs the workspace it touches.
    this.logger.info(
      {
        queue,
        job_id: job.id,
        job_name: job.name,
        workspace_id: workspaceId,
        attempt: job.attemptsMade + 1,
      },
      'job started',
    );
    return this.processors.dispatch(queue, job);
  }

  private onError(source: string, err: Error): void {
    this.logger.error({ source, err }, 'redis/queue error');
  }
}
