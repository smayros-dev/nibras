import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDbName, testRedisDb } from '@nibras/config/vitest/test-env';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../src/auth/decorators/public';
import { createTestApp, type TestAgent } from './helpers/app';

/** Refuses any body with a `blob` (so an accepted large body ends at zod with 422, not at 201). */
class BodyLimitDto extends createZodDto(z.object({ name: z.string() }).strict()) {}

/** Test-only route, mounted next to AppModule by this spec alone. */
@Public()
@Controller('__test')
class BodyLimitController {
  @Post('body-limit')
  @HttpCode(HttpStatus.OK)
  echo(@Body() body: BodyLimitDto): { ok: true } {
    void body;
    return { ok: true };
  }
}

describe('http setup (shared with main.ts)', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let http: TestAgent;

  beforeAll(async () => {
    ({ app, http } = await createTestApp({ controllers: [BodyLimitController] }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('runs against its own test database and Redis index (nibras_api_test, DB 14 by default)', () => {
    // Without the worktree knobs (TEST_DB_PREFIX / TEST_REDIS_DB_BASE) these are nibras_api_test and 14.
    expect(testDbName('api', {})).toBe('nibras_api_test');
    expect(testRedisDb('api', {})).toBe(14);
    if (process.env.REDIS_URL_TEST) {
      expect(process.env.REDIS_URL).toBe(process.env.REDIS_URL_TEST);
      expect(new URL(process.env.REDIS_URL ?? '').pathname).toBe(`/${testRedisDb('api')}`);
    }
    if (process.env.DATABASE_URL_TEST) {
      expect(new URL(process.env.DATABASE_URL ?? '').pathname).toBe(`/${testDbName('api')}`);
    }
  });

  it('sends helmet headers forbidding framing', async () => {
    const res = await http.get('/health/live').expect(200);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('allows credentialed CORS from WEB_ORIGIN only', async () => {
    const origin = process.env.WEB_ORIGIN ?? '';
    const ok = await http.get('/health/live').set('Origin', origin).expect(200);
    expect(ok.headers['access-control-allow-origin']).toBe(origin);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');

    const evil = await http.get('/health/live').set('Origin', 'https://evil.example').expect(200);
    expect(evil.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });

  it('JSON body limit is 1 MiB: 900 kB reaches validation (422), 1.2 MB → 413 PAYLOAD_TOO_LARGE', async () => {
    await http
      .post('/api/v1/__test/body-limit')
      .send({ blob: 'x'.repeat(900 * 1000) })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('VALIDATION_FAILED'));
    await http
      .post('/api/v1/__test/body-limit')
      .send({ blob: 'x'.repeat(1_200_000) })
      .expect(413)
      .expect(({ body }) => expect(body.code).toBe('PAYLOAD_TOO_LARGE'));
  });
});
