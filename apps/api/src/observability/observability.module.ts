import { Module } from '@nestjs/common';
import { AppLoggerModule } from './logger.module';
import { MetricsController } from './metrics.controller';
import { MetricsMiddleware } from './metrics.middleware';

/**
 * Structured logging (pino) and Prometheus metrics. `MetricsMiddleware` is applied by `AppModule`
 * right after `RequestIdMiddleware`. Tracing starts in `tracing.ts`, before Nest.
 */
@Module({
  imports: [AppLoggerModule],
  controllers: [MetricsController],
  providers: [MetricsMiddleware],
})
export class ObservabilityModule {}
