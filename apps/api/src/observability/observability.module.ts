import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppLoggerModule } from './logger.module';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';

/** Structured logging (pino) and Prometheus metrics. Tracing starts in `tracing.ts`, before Nest. */
@Module({
  imports: [AppLoggerModule],
  controllers: [MetricsController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
})
export class ObservabilityModule {}
