import { Writable } from 'node:stream';
import type { INestApplication, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { LOG_DESTINATION } from '../../src/observability/logger.module';

export type TestAgent = ReturnType<typeof request.agent>;

/** Log lines the app wrote (parsed JSON), captured in memory instead of stdout. */
export interface CapturedLogs {
  lines(): Record<string, unknown>[];
  clear(): void;
}

export interface CreateTestAppOptions {
  /** Swap providers (e.g. `b.overrideProvider(TOKEN).useValue(fake)`). */
  overrides?: (b: TestingModuleBuilder) => TestingModuleBuilder;
  /** Extra controllers mounted next to `AppModule` (test-only routes). */
  controllers?: Type<unknown>[];
}

function captureLogs(): { sink: Writable; logs: CapturedLogs } {
  let lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
      callback();
    },
  });
  const logs: CapturedLogs = {
    lines: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    clear: () => {
      lines = [];
    },
  };
  return { sink, logs };
}

/**
 * Boots `AppModule` configured exactly like `main.ts` (prefix, helmet, CORS, pino logger, global
 * filter/pipe/middleware), listening on an ephemeral port. Logs go to `logs` so test output stays
 * pristine. Call `app.close()` to tear down.
 */
export async function createTestApp(
  opts: CreateTestAppOptions = {},
): Promise<{ app: INestApplication; http: TestAgent; logs: CapturedLogs }> {
  const { sink, logs } = captureLogs();
  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: opts.controllers ?? [],
  })
    .overrideProvider(LOG_DESTINATION)
    .useValue(sink);
  if (opts.overrides) builder = opts.overrides(builder);
  const moduleRef = await builder.compile();
  // Nest's own boot logs stay off; `configureApp` routes the app's logs to pino (`logs`).
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  return { app, http: request.agent(app.getHttpServer()), logs };
}
