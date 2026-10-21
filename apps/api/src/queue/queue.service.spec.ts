import { importJobId, type QueueName } from '@nibras/contracts';
import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { redisConnection } from './queue.module';
import { assertBullmqJobId, FakeQueueService, QueueService } from './queue.service';

describe('QueueService', () => {
  it('adds the job to the named queue with the per-job options', async () => {
    const add = vi.fn().mockResolvedValue({ id: '1' });
    const service = new QueueService(new Map([['compliance', { add } as unknown as Queue]]));
    await service.add('compliance', 'abuse.minor_safety_reminder', { reportId: 'r' }, { delay: 5 });
    expect(add).toHaveBeenCalledWith(
      'abuse.minor_safety_reminder',
      { reportId: 'r' },
      { delay: 5 },
    );
  });

  it('rejects an unknown queue', async () => {
    const service = new QueueService(new Map());
    await expect(service.add('nope' as QueueName, 'x', {})).rejects.toThrow(/unknown queue/);
  });
});

describe('FakeQueueService', () => {
  it('records jobs and clears them', async () => {
    const fake = new FakeQueueService();
    await fake.add('notifications', 'a', { id: 1 });
    await fake.add('compliance', 'b', null, { jobId: 'j' });
    expect(fake.jobs).toEqual([
      { queue: 'notifications', name: 'a', data: { id: 1 } },
      { queue: 'compliance', name: 'b', data: null, opts: { jobId: 'j' } },
    ]);
    fake.clear();
    expect(fake.jobs).toEqual([]);
  });

  it('refuses the job ids BullMQ refuses (integer, or a `:` count other than three parts)', async () => {
    const fake = new FakeQueueService();
    await expect(fake.add('imports', 'x', null, { jobId: '42' })).rejects.toThrow(/integers/);
    await expect(fake.add('imports', 'x', null, { jobId: 'import:abc' })).rejects.toThrow(
      /cannot contain :/,
    );
    await fake.add('imports', 'x', null, { jobId: 'import:abc:csv' });
    await fake.add('compliance', 'y', null, { jobId: 'plain-id' });
    expect(fake.jobs).toHaveLength(2);
    expect(() => assertBullmqJobId(importJobId('0192-id'))).not.toThrow();
  });
});

describe('redisConnection', () => {
  it('keeps host, port, DB index and credentials, with TLS for rediss:', () => {
    expect(redisConnection('redis://localhost:6379/14')).toEqual({
      host: 'localhost',
      port: 6379,
      db: 14,
    });
    expect(redisConnection('redis://cache')).toEqual({ host: 'cache', port: 6379, db: 0 });
    expect(redisConnection('rediss://u%40x:p%2Fw@host:6380/2')).toEqual({
      host: 'host',
      port: 6380,
      db: 2,
      username: 'u@x',
      password: 'p/w',
      tls: {},
    });
  });

  it('never falls back to DB 0 on a malformed index', () => {
    expect(() => redisConnection('redis://localhost:6379/abc')).toThrow(/invalid Redis DB index/);
  });
});
