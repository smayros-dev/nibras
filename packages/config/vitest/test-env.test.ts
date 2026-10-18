import { describe, expect, it } from 'vitest';
import {
  applyTestEnv,
  testDatabaseUrl,
  testDbName,
  testRedisDb,
  testRedisUrl,
} from './test-env.mjs';

describe('per-package test env', () => {
  it('derives nibras_<pkg>_test from the base URL, keeping credentials and query', () => {
    expect(
      testDatabaseUrl('postgresql://app_user:app@localhost:5432/nibras_test?schema=public', 'api'),
    ).toBe('postgresql://app_user:app@localhost:5432/nibras_api_test?schema=public');
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
      DATABASE_URL_TEST: 'postgresql://app_user:app@localhost:5432/nibras_test',
      DATABASE_URL_TEST_SYSTEM: 'postgresql://app_system:app@localhost:5432/nibras_test',
      DATABASE_URL: 'postgresql://app_user:app@localhost:5432/nibras',
    };
    applyTestEnv('worker', env);
    expect(env).toEqual({
      DATABASE_URL_TEST: 'postgresql://app_user:app@localhost:5432/nibras_worker_test',
      DATABASE_URL_TEST_SYSTEM: 'postgresql://app_system:app@localhost:5432/nibras_worker_test',
      DATABASE_URL: 'postgresql://app_user:app@localhost:5432/nibras',
    });
  });

  it('TEST_DB_PREFIX and TEST_REDIS_DB_BASE drive the per-worktree names', () => {
    const env: Record<string, string | undefined> = {
      TEST_DB_PREFIX: 'nibras_t3',
      TEST_REDIS_DB_BASE: '10',
      DATABASE_URL_TEST: 'postgresql://u:p@h:5432/nibras_test?schema=public',
      REDIS_URL_TEST: 'redis://h:6379/15',
    };
    applyTestEnv('api', env);
    expect(env.DATABASE_URL_TEST).toBe('postgresql://u:p@h:5432/nibras_t3_api_test?schema=public');
    expect(env.REDIS_URL_TEST).toBe('redis://h:6379/11');
    expect(testDbName('worker', {})).toBe('nibras_worker_test');
    expect(testRedisDb('worker', {})).toBe(15);
    for (const bad of ['0', '14', 'x', '-1']) {
      expect(() => testRedisDb('db', { TEST_REDIS_DB_BASE: bad })).toThrow(/TEST_REDIS_DB_BASE/);
    }
  });

  it('rejects a TEST_DB_PREFIX that is not a lower-case Postgres identifier', () => {
    for (const bad of ['', 'NIBRAS_T1', 'nibras-t1']) {
      expect(() => testDbName('db', { TEST_DB_PREFIX: bad })).toThrow(/TEST_DB_PREFIX/);
    }
    expect(testDbName('api', { TEST_DB_PREFIX: 'nibras_t1' })).toBe('nibras_t1_api_test');
  });
});
