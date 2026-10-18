import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDbName, testRedisDb } from '@nibras/config/vitest/test-env';
import { createTestApp, type TestAgent } from './helpers/app';

describe('http setup (shared with main.ts)', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let http: TestAgent;

  beforeAll(async () => {
    ({ app, http } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  it('runs against its own test database and Redis index (tt_api_test, DB 14 by default)', () => {
    // Without the worktree knobs (TEST_DB_PREFIX / TEST_REDIS_DB_BASE) these are tt_api_test and 14.
    expect(testDbName('api', {})).toBe('tt_api_test');
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
});
