import { Controller, Get, Inject, Res, ServiceUnavailableException } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import type { PrismaClient } from '@nibras/db';
import type { Response } from 'express';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { Public } from '../auth/decorators/public';
import { TimeoutError, withTimeout } from '../common/with-timeout';

/** Injection token for the Prisma client (`app_user`) the readiness probe pings. */
export const DB_HEALTH_CLIENT = Symbol('DB_HEALTH_CLIENT');

/** A dependency that does not answer within this budget counts as down (no hanging probes). */
const CHECK_TIMEOUT_MS = 1000;

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    @Inject(DB_HEALTH_CLIENT) private readonly db: Pick<PrismaClient, '$queryRaw'>,
    @Inject(REDIS) private readonly redis: Pick<Redis, 'ping'>,
  ) {}

  /** Process is up. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Dependencies reachable: 200 with Terminus' report, 503 with the same report otherwise. */
  @Get('ready')
  @HealthCheck()
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthCheckResult> {
    try {
      return await this.health.check([
        () => this.probe('db', () => this.db.$queryRaw`SELECT 1`),
        () => this.probe('redis', () => this.redis.ping()),
      ]);
    } catch (err) {
      // Terminus throws 503 with the report; send it as-is rather than as an error envelope.
      if (!(err instanceof ServiceUnavailableException)) throw err;
      res.status(err.getStatus());
      return err.getResponse() as HealthCheckResult;
    }
  }

  private async probe(key: string, ping: () => Promise<unknown>): Promise<HealthIndicatorResult> {
    const check = this.indicator.check(key);
    try {
      await withTimeout(ping(), CHECK_TIMEOUT_MS);
      return check.up();
    } catch (err) {
      return check.down({ message: err instanceof TimeoutError ? err.message : 'unreachable' });
    }
  }
}
