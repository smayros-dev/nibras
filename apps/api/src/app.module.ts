import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { ZodValidationPipe } from './common/zod-validation.pipe';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { MetricsMiddleware } from './observability/metrics.middleware';
import { ObservabilityModule } from './observability/observability.module';
import { ProvidersModule } from './providers/providers.module';
import { QueueModule } from './queue/queue.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ObservabilityModule,
    DbModule,
    RedisModule,
    QueueModule,
    ProvidersModule,
    AuditModule,
    EventEmitterModule.forRoot(),
    AuthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route, including the unprefixed health endpoints (Nest 11 / path-to-regexp v8
    // wildcard). Metrics come right after the request id, so requests rejected later (unknown
    // routes, guards) are still timed.
    consumer.apply(RequestIdMiddleware, MetricsMiddleware).forRoutes('{*path}');
  }
}
