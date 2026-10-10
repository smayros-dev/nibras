// Must stay the first import: OpenTelemetry patches modules as they load.
import { shutdownTracing } from './observability/tracing';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  // Boot logs are buffered until `configureApp` installs the pino logger.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  configureApp(app);
  // Instead of `enableShutdownHooks()`: close Nest (lifecycle hooks), then flush pending spans.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void app
        .close()
        .then(shutdownTracing)
        .finally(() => process.exit(0));
    });
  }
  await app.listen(env.PORT);
  Logger.log(`API listening on port ${env.PORT}`, 'Bootstrap');
}

void bootstrap();
