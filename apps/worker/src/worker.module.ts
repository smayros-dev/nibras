import 'reflect-metadata';

import {
  type DynamicModule,
  Inject,
  type INestApplicationContext,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createPrismaClient, type PrismaClient } from '@nibras/db';
import type { Logger } from 'pino';

import { loadEnv, WORKER_ENV, type WorkerEnv } from './env';
import { HealthServer } from './health-server';
import { createLogger, PinoNestLogger, WORKER_LOGGER } from './logger';
import { AbuseProcessor } from './processors/abuse.processor';
import { PingProcessor } from './processors/ping.processor';
import { createEmailProvider, EMAIL_PROVIDER } from './providers';
import { ProcessorRegistry, QueueRegistry } from './queues';
import { WORKER_DB } from './worker-db';

export { WORKER_DB } from './worker-db';

@Module({})
export class WorkerModule implements OnApplicationShutdown {
  constructor(@Inject(WORKER_DB) private readonly db: PrismaClient) {}

  static register(env: WorkerEnv, logger: Logger): DynamicModule {
    return {
      module: WorkerModule,
      providers: [
        { provide: WORKER_ENV, useValue: env },
        { provide: WORKER_LOGGER, useValue: logger },
        { provide: WORKER_DB, useFactory: () => createPrismaClient(env.DATABASE_URL_SYSTEM) },
        { provide: EMAIL_PROVIDER, useFactory: () => createEmailProvider(env) },
        ProcessorRegistry,
        QueueRegistry,
        HealthServer,
        PingProcessor,
        AbuseProcessor,
      ],
      exports: [WORKER_DB, WORKER_LOGGER, EMAIL_PROVIDER, ProcessorRegistry, QueueRegistry],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.$disconnect();
  }
}

export interface WorkerContext {
  app: INestApplicationContext;
  close(): Promise<void>;
}

/** Boots the worker from `process.env`: queues, workers, processors and health server. */
export async function createWorkerContext(): Promise<WorkerContext> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const app = await NestFactory.createApplicationContext(WorkerModule.register(env, logger), {
    logger: new PinoNestLogger(logger),
  });
  await app.init();
  let closing: Promise<void> | undefined;
  return {
    app,
    close: () => (closing ??= app.close()),
  };
}
