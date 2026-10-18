import { Writable } from 'node:stream';
import type { INestApplication, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { resetDatabase, systemPrisma, type PrismaClient } from '@nibras/db';
import { InMemoryEmailProvider, InMemorySmsProvider } from '@nibras/providers';
import type Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { FakePwnedClient } from '../../src/auth/crypto/hibp';
import { LOG_DESTINATION } from '../../src/observability/logger.module';
import { REDIS } from '../../src/redis/redis.module';
import { EMAIL_PROVIDER, PWNED_CLIENT, SMS_PROVIDER } from '../../src/providers/providers.module';
import { FakeQueueService, QueueService } from '../../src/queue/queue.service';

/**
 * Stateless supertest client: no cookie jar, so a response's `Set-Cookie` never leaks into later
 * requests (or later tests). Specs pass cookies explicitly (`helpers/auth.ts`: `as`, `loginAs`).
 */
export type TestAgent = ReturnType<typeof request>;

/** Log lines the app wrote (parsed JSON), captured in memory instead of stdout. */
export interface CapturedLogs {
  lines(): Record<string, unknown>[];
  clear(): void;
}

export interface CreateTestAppOptions {
  /**
   * Swap providers (e.g. `b.overrideProvider(TOKEN).useValue(fake)`). Runs after the default
   * fakes (email, SMS, queue, pwned passwords) are installed and may replace any of them.
   */
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
 * filter/pipe/middleware), listening on an ephemeral port, with in-memory fakes for the outbound
 * providers and the job queues. Logs go to `logs` so test output stays pristine. Specs that touch
 * the database call `beforeEach(() => ctx.reset())`; call `app.close()` to tear down.
 */
export async function createTestApp(opts: CreateTestAppOptions = {}) {
  const { sink, logs } = captureLogs();
  const email = new InMemoryEmailProvider();
  const sms = new InMemorySmsProvider();
  const queue = new FakeQueueService();
  const pwned = new FakePwnedClient();
  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: opts.controllers ?? [],
  })
    .overrideProvider(LOG_DESTINATION)
    .useValue(sink)
    .overrideProvider(EMAIL_PROVIDER)
    .useValue(email)
    .overrideProvider(SMS_PROVIDER)
    .useValue(sms)
    .overrideProvider(QueueService)
    .useValue(queue)
    .overrideProvider(PWNED_CLIENT)
    .useValue(pwned);
  if (opts.overrides) builder = opts.overrides(builder);
  const moduleRef = await builder.compile();
  // Nest's own boot logs stay off; `configureApp` routes the app's logs to pino (`logs`).
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  /** `app_system` (BYPASSRLS) on this package's test database: fixtures and assertions. */
  const db: PrismaClient = systemPrisma();
  return {
    app: app as INestApplication,
    http: request(app.getHttpServer()),
    logs,
    db,
    email,
    sms,
    queue,
    pwned,
    /**
     * Empties the database (refuses a non-`_test` one), this package's test Redis index (login
     * throttle and rate-limit counters; refuses DB 0) and every fake.
     */
    async reset(): Promise<void> {
      await resetDatabase(db);
      await flushTestRedis(app.get<Redis>(REDIS));
      email.clear();
      sms.clear();
      queue.clear();
      pwned.clear();
      logs.clear();
    },
  };
}

/** FLUSHDB on the API's Redis connection, only when it points at a test index (never DB 0). */
async function flushTestRedis(redis: Redis): Promise<void> {
  const index = Number(new URL(process.env.REDIS_URL ?? '').pathname.slice(1) || 0);
  if (!(index > 0)) throw new Error(`refusing to flush Redis DB ${index} (not a test index)`);
  await redis.flushdb();
}

export type TestContext = Awaited<ReturnType<typeof createTestApp>>;
