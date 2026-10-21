// Must stay the first import: OpenTelemetry patches modules as they load.
import { shutdownTracing } from './observability/tracing';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { env } from './config/env';
import { configureHttpServer } from './http-server';
import { createShutdownHandler } from './shutdown';

/** Upper bound on a graceful shutdown before the process is forced out. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function bootstrap(): Promise<void> {
  // Boot logs are buffered until `configureApp` installs the pino logger. `rawBody`: the media
  // webhooks verify their HMAC over the exact bytes received (`req.rawBody`).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  configureApp(app);
  // Instead of `enableShutdownHooks()`: close Nest (lifecycle hooks), then flush pending spans.
  const shutdown = createShutdownHandler({
    close: () => app.close(),
    flush: shutdownTracing,
    exit: (code) => process.exit(code),
    logError: (message) => Logger.error(message, 'Shutdown'),
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, (received) => void shutdown(received));
  }
  configureHttpServer(app.getHttpServer());
  await app.listen(env.PORT);
  Logger.log(`API listening on port ${env.PORT}`, 'Bootstrap');
}

void bootstrap();
