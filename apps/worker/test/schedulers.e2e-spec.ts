import { Test } from '@nestjs/testing';
import {
  DAILY_SCHEDULER_PATTERN,
  GUARDIAN_CONSENT_EXPIRE_JOB,
  GUARDIAN_CONSENT_EXPIRE_SCHEDULER_ID,
  INVITATION_EXPIRE_JOB,
  INVITATION_EXPIRE_SCHEDULER_ID,
  QUEUES,
} from '@nibras/contracts';
import { InMemoryEmailProvider } from '@nibras/providers';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { EMAIL_PROVIDER } from '../src/providers';
import { SCHEDULERS, Schedulers } from '../src/schedulers';
import { WorkerModule } from '../src/worker.module';
import { obliterateAllQueues, redisOpts } from './redis';

async function boot() {
  const moduleRef = await Test.createTestingModule({
    imports: [WorkerModule.register(loadEnv(), createLogger('silent'))],
  })
    .overrideProvider(EMAIL_PROVIDER)
    .useValue(new InMemoryEmailProvider())
    .compile();
  await moduleRef.init();
  // The upserts run in the background (the boot never waits on Redis).
  await moduleRef.get(Schedulers).ready;
  return moduleRef;
}

describe('daily job schedulers (AC-INV-12)', () => {
  const compliance = new Queue(QUEUES.compliance, { connection: redisOpts });

  beforeAll(async () => {
    await obliterateAllQueues();
  });

  afterAll(async () => {
    await compliance.close();
    await obliterateAllQueues();
  });

  it('declares the two compliance schedulers', () => {
    expect(SCHEDULERS).toEqual([
      {
        id: GUARDIAN_CONSENT_EXPIRE_SCHEDULER_ID,
        queue: QUEUES.compliance,
        jobName: GUARDIAN_CONSENT_EXPIRE_JOB,
      },
      {
        id: INVITATION_EXPIRE_SCHEDULER_ID,
        queue: QUEUES.compliance,
        jobName: INVITATION_EXPIRE_JOB,
      },
    ]);
  });

  it('after bootstrap, compliance has the two schedulers at 03:00 UTC; a second bootstrap does not duplicate them', async () => {
    const expected = [
      {
        key: GUARDIAN_CONSENT_EXPIRE_SCHEDULER_ID,
        name: GUARDIAN_CONSENT_EXPIRE_JOB,
        pattern: DAILY_SCHEDULER_PATTERN,
        tz: 'UTC',
      },
      {
        key: INVITATION_EXPIRE_SCHEDULER_ID,
        name: INVITATION_EXPIRE_JOB,
        pattern: DAILY_SCHEDULER_PATTERN,
        tz: 'UTC',
      },
    ];
    const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);

    const first = await boot();
    try {
      const schedulers = (await compliance.getJobSchedulers()).sort(byKey);
      // `expected` is in key order.
      expect(schedulers).toEqual(expected.map((e) => expect.objectContaining(e)));
      expect(schedulers).toHaveLength(2);
      const template = await compliance.getJobScheduler(GUARDIAN_CONSENT_EXPIRE_SCHEDULER_ID);
      expect(template?.template?.opts).toMatchObject({ attempts: 3 });
    } finally {
      await first.close();
    }

    const second = await boot();
    try {
      expect(await compliance.getJobSchedulersCount()).toBe(2);
      // One pending (delayed) occurrence per scheduler, never two.
      expect(await compliance.getDelayedCount()).toBe(2);
    } finally {
      await second.close();
    }
  });
});
