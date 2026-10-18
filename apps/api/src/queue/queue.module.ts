import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Global, Logger, Module } from '@nestjs/common';
import { DEFAULT_JOB_OPTIONS, QUEUES, type QueueName } from '@nibras/contracts';
import type { ConnectionOptions, Queue } from 'bullmq';
import { env } from '../config/env';
import { QUEUES_BY_NAME, QueueService } from './queue.service';

const QUEUE_NAMES = Object.values(QUEUES);

/**
 * BullMQ connection options from `REDIS_URL` (`redis:`/`rediss:` only, checked by the env schema),
 * keeping the DB index (`/14`) so tests and environments never share queues.
 */
export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  const match = /^\/?(\d*)$/.exec(u.pathname);
  if (!match) throw new Error(`redisConnection: invalid Redis DB index in path "${u.pathname}"`);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    db: Number(match[1] || 0),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

/** Producer side of the job queues (the worker consumes them). */
@Global()
@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnection(env.REDIS_URL) }),
    BullModule.registerQueue(
      ...QUEUE_NAMES.map((name) => ({ name, defaultJobOptions: DEFAULT_JOB_OPTIONS })),
    ),
  ],
  providers: [
    {
      provide: QUEUES_BY_NAME,
      inject: QUEUE_NAMES.map((name) => getQueueToken(name)),
      useFactory: (...queues: Queue[]): ReadonlyMap<QueueName, Queue> => {
        const logger = new Logger('Queue');
        // Without a listener an EventEmitter 'error' (Redis down) would crash the process.
        for (const queue of queues) {
          queue.on('error', (err: Error) => logger.warn(`queue ${queue.name}: ${err.message}`));
        }
        return new Map(QUEUE_NAMES.map((name, i) => [name, queues[i]!]));
      },
    },
    QueueService,
  ],
  // QUEUES_BY_NAME: read-only inspection (`GET /admin/health` job counts).
  exports: [QueueService, QUEUES_BY_NAME],
})
export class QueueModule {}
