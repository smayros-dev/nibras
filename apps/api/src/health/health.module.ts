import { Inject, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { createPrismaClient, type PrismaClient } from '@nibras/db';
import { env } from '../config/env';
import { DB_HEALTH_CLIENT, HealthController } from './health.controller';

export { DB_HEALTH_CLIENT };

type DbLifecycle = Pick<PrismaClient, '$connect' | '$disconnect'>;

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [
    // The RLS-bound `app_user` role: readiness proves the API's own credentials work.
    { provide: DB_HEALTH_CLIENT, useFactory: () => createPrismaClient(env.DATABASE_URL) },
  ],
})
export class HealthModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthModule.name);

  constructor(@Inject(DB_HEALTH_CLIENT) private readonly db: DbLifecycle) {}

  /**
   * Opens the pool at boot so the first readiness probe is not spent connecting. A failure is
   * not fatal: the API still starts and `/health/ready` reports `db` down until it recovers.
   */
  async onModuleInit(): Promise<void> {
    await this.db.$connect().catch((err: unknown) => {
      this.logger.warn(`database not reachable at startup: ${(err as Error).message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    // A client that never connected rejects here; shutdown must still complete.
    await this.db.$disconnect().catch(() => undefined);
  }
}
