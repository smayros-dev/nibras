import { describe, expect, it } from 'vitest';
import { applyTestEnv, testDatabaseUrl, testRedisUrl } from './test-env.js';

describe('per-package test env', () => {
  it('derives tt_<pkg>_test from the base URL, keeping credentials and query', () => {
    expect(
      testDatabaseUrl('postgresql://app_user:app@localhost:5432/tt_test?schema=public', 'api'),
    ).toBe('postgresql://app_user:app@localhost:5432/tt_api_test?schema=public');
  });

  it('gives each package its own non-zero Redis index', () => {
    const base = 'redis://localhost:6379/15';
    expect(testRedisUrl(base, 'db')).toBe('redis://localhost:6379/13');
    expect(testRedisUrl(base, 'api')).toBe('redis://localhost:6379/14');
    expect(testRedisUrl(base, 'worker')).toBe('redis://localhost:6379/15');
    expect(testRedisUrl('redis://localhost:6379', 'api')).toBe('redis://localhost:6379/14');
  });

  it('rewrites only the base test variables that are set', () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL_TEST: 'postgresql://app_user:app@localhost:5432/tt_test',
      DATABASE_URL_TEST_SYSTEM: 'postgresql://app_system:app@localhost:5432/tt_test',
      DATABASE_URL: 'postgresql://app_user:app@localhost:5432/tt',
    };
    applyTestEnv('worker', env);
    expect(env).toEqual({
      DATABASE_URL_TEST: 'postgresql://app_user:app@localhost:5432/tt_worker_test',
      DATABASE_URL_TEST_SYSTEM: 'postgresql://app_system:app@localhost:5432/tt_worker_test',
      DATABASE_URL: 'postgresql://app_user:app@localhost:5432/tt',
    });
  });
});
