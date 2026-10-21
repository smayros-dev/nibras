import { describe, expect, it } from 'vitest';
import {
  applyTestEnv,
  testDatabaseUrl,
  testDbName,
  testRedisDb,
  testBucketName,
  testRedisUrl,
  TEST_PACKAGES,
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

  it('derives a per-package S3 test bucket from S3_BUCKET_TEST', () => {
    expect(TEST_PACKAGES).toEqual(['db', 'api', 'worker']); // providers: no test database
    expect(testBucketName('api')).toBe('nibras-api-test');
    expect(testBucketName('api', {})).toBe('nibras-api-test');
    expect(testBucketName('providers', { S3_BUCKET_TEST: 'nibras-test' })).toBe(
      'nibras-providers-test',
    );
    // A per-checkout base keeps parallel checkouts on one MinIO apart.
    expect(testBucketName('worker', { S3_BUCKET_TEST: 'nibras-sp3-test' })).toBe(
      'nibras-sp3-worker-test',
    );
    expect(testBucketName('api', { S3_BUCKET_TEST: 'mybucket' })).toBe('mybucket-api');
    for (const bad of ['', 'Nibras-Test', 'nibras_test', 'ab']) {
      expect(() => testBucketName('api', { S3_BUCKET_TEST: bad })).toThrow(/S3_BUCKET_TEST/);
    }
  });

  it('applyTestEnv rewrites S3_BUCKET_TEST only when set', () => {
    const env: Record<string, string | undefined> = { S3_BUCKET_TEST: 'nibras-test' };
    applyTestEnv('api', env);
    expect(env.S3_BUCKET_TEST).toBe('nibras-api-test');
    const empty: Record<string, string | undefined> = {};
    applyTestEnv('api', empty);
    expect(empty).toEqual({});
  });

  it('providers get a bucket only (no database, no Redis index)', () => {
    const env: Record<string, string | undefined> = {
      TEST_REDIS_DB_BASE: '13',
      DATABASE_URL_TEST: 'postgresql://u:p@h:5432/nibras_test',
      REDIS_URL_TEST: 'redis://h:6379/15',
      S3_BUCKET_TEST: 'nibras-test',
    };
    applyTestEnv('providers', env);
    expect(env).toEqual({
      TEST_REDIS_DB_BASE: '13',
      DATABASE_URL_TEST: 'postgresql://u:p@h:5432/nibras_test',
      REDIS_URL_TEST: 'redis://h:6379/15',
      S3_BUCKET_TEST: 'nibras-providers-test',
    });
    expect(() => testRedisDb('providers', {})).toThrow(/no test Redis index/);
  });
});
