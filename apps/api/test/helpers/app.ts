import type { INestApplication, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

export type TestAgent = ReturnType<typeof request.agent>;

export interface CreateTestAppOptions {
  /** Swap providers (e.g. `b.overrideProvider(TOKEN).useValue(fake)`). */
  overrides?: (b: TestingModuleBuilder) => TestingModuleBuilder;
  /** Extra controllers mounted next to `AppModule` (test-only routes). */
  controllers?: Type<unknown>[];
}

/**
 * Boots `AppModule` configured exactly like `main.ts` (prefix, helmet, CORS, global
 * filter/pipe/middleware), listening on an ephemeral port. Call `app.close()` to tear down.
 */
export async function createTestApp(
  opts: CreateTestAppOptions = {},
): Promise<{ app: INestApplication; http: TestAgent }> {
  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: opts.controllers ?? [],
  });
  if (opts.overrides) builder = opts.overrides(builder);
  const moduleRef = await builder.compile();
  // Keep test output pristine; specs that assert on logs spy on `Logger.prototype`.
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  return { app, http: request.agent(app.getHttpServer()) };
}
