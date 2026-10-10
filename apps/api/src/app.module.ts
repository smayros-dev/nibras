import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { ZodValidationPipe } from './common/zod-validation.pipe';
import { HealthModule } from './health/health.module';
import { ObservabilityModule } from './observability/observability.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [ObservabilityModule, RedisModule, HealthModule],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route, including the unprefixed health endpoints (Nest 11 / path-to-regexp v8 wildcard).
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
