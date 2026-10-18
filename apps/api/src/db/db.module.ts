import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { db, onPrismaLog, type GuardedClient, type PrismaLogHandler } from '@nibras/db';
import { PinoLogger } from 'nestjs-pino';
import { forwardPrismaLogs } from './prisma-logs';

/** Injection token for `db` (`@nibras/db`'s guarded `app_user` client: RLS, non-tenant tables). */
export const DB = Symbol('DB');

/**
 * `onPrismaLog` attaches listeners to process-wide Prisma clients that cannot be detached, so it
 * is called once per process; the listener forwards to the logger of the live app (tests boot
 * several apps in one process, one after the other).
 */
let forward: PrismaLogHandler | undefined;
let attached = false;

@Global()
@Module({
  providers: [{ provide: DB, useValue: db }],
  exports: [DB],
})
export class DbModule implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown {
  private readonly handler: PrismaLogHandler;

  constructor(
    logger: PinoLogger,
    @Inject(DB) private readonly client: Pick<GuardedClient, '$disconnect'>,
  ) {
    logger.setContext('Prisma');
    this.handler = forwardPrismaLogs(logger);
  }

  onModuleInit(): void {
    forward = this.handler;
    if (!attached) {
      onPrismaLog((level, event) => forward?.(level, event));
      attached = true;
    }
  }

  onModuleDestroy(): void {
    if (forward === this.handler) forward = undefined;
  }

  async onApplicationShutdown(): Promise<void> {
    // Releases the pool on shutdown; the client reconnects lazily if used again (tests).
    await this.client.$disconnect().catch(() => undefined);
  }
}
