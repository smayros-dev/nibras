import { DEFAULT_JOB_OPTIONS } from '@nibras/contracts';
import type { JobsOptions } from 'bullmq';
import { describe, expect, it } from 'vitest';

import { redisConnection } from './queues';

describe('redisConnection', () => {
  it('keeps the DB index from the path', () => {
    expect(redisConnection('redis://localhost:6379/8')).toMatchObject({
      host: 'localhost',
      port: 6379,
      db: 8,
      maxRetriesPerRequest: null,
    });
  });

  it('defaults to DB 0 and port 6379 without a path', () => {
    expect(redisConnection('redis://cache')).toMatchObject({ host: 'cache', port: 6379, db: 0 });
    expect(redisConnection('redis://cache/')).toMatchObject({ db: 0 });
  });

  it('decodes credentials and enables TLS for rediss:', () => {
    expect(redisConnection('rediss://u%40x:p%2Fw@host:6380/2')).toMatchObject({
      username: 'u@x',
      password: 'p/w',
      port: 6380,
      db: 2,
      tls: {},
    });
  });

  it.each(['redis://localhost:6379/abc', 'redis://localhost:6379/1.5', 'redis://localhost/8/x'])(
    'rejects the malformed DB index in %s',
    (url) => {
      expect(() => redisConnection(url)).toThrow(/invalid Redis DB index/);
    },
  );

  it('rejects non-Redis schemes', () => {
    expect(() => redisConnection('http://localhost:6379/8')).toThrow(/redis: or rediss:/);
  });
});

describe('DEFAULT_JOB_OPTIONS (from @nibras/contracts)', () => {
  it('is a valid BullMQ JobsOptions', () => {
    const options: JobsOptions = DEFAULT_JOB_OPTIONS;
    expect(options).toMatchObject({ attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
  });
});
