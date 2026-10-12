import { Test, type TestingModule } from '@nestjs/testing';
import { QUEUES } from '@tt/contracts';
import { resetDatabase, systemPrisma, type User } from '@tt/db';
import { InMemoryEmailProvider } from '@tt/providers';
import type { Job } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { EMAIL_PROVIDER } from '../src/providers';
import { ProcessorRegistry } from '../src/queues';
import { WorkerModule } from '../src/worker.module';
import { obliterateAllQueues } from './redis';

const db = systemPrisma();

let n = 0;
function user(platformRole: User['platformRole'] = 'NONE'): Promise<User> {
  n += 1;
  return db.user.create({
    data: {
      email: `worker-${n}-${Date.now()}@example.com`,
      firstName: 'W',
      lastName: 'User',
      platformRole,
    },
  });
}

async function report(reporter: User, status: 'OPEN' | 'RESOLVED') {
  return db.abuseReport.create({
    data: {
      reporterUserId: reporter.id,
      category: 'MINOR_SAFETY',
      description: 'Comportement inapproprié pendant la session.',
      entityType: 'USER',
      entityId: reporter.id,
      contextSnapshot: {},
      status,
    },
  });
}

/** Runs the registered processor directly, as BullMQ would (`progress` survives a retry). */
function run(registry: ProcessorRegistry, reportId: string, progress: unknown = 0) {
  const job = {
    name: 'abuse.minor_safety_reminder',
    id: `abuse:${reportId}:minor-safety-reminder`,
    data: { reportId },
    progress,
    updateProgress(p: unknown) {
      job.progress = p;
      return Promise.resolve();
    },
  };
  return registry.dispatch(QUEUES.compliance, job as unknown as Job);
}

describe('abuse.minor_safety_reminder processor (AC-SAFE-05)', () => {
  let moduleRef: TestingModule;
  let registry: ProcessorRegistry;
  const email = new InMemoryEmailProvider();

  beforeAll(async () => {
    const env = loadEnv();
    moduleRef = await Test.createTestingModule({
      imports: [WorkerModule.register(env, createLogger('silent'))],
    })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(email)
      .compile();
    await moduleRef.init();
    registry = moduleRef.get(ProcessorRegistry);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await obliterateAllQueues();
  });

  beforeEach(async () => {
    await obliterateAllQueues();
    await resetDatabase(db);
    email.clear();
  });

  it('emails every active SUPER_ADMIN while the report is still OPEN', async () => {
    const [sa1, sa2, reporter] = [
      await user('SUPER_ADMIN'),
      await user('SUPER_ADMIN'),
      await user(),
    ];
    const open = await report(reporter, 'OPEN');
    await run(registry, open.id);
    const sent = email.findByTemplate('abuse.minor_safety_reminder');
    expect(sent.map((m) => m.to).sort()).toEqual([sa1.email, sa2.email].sort());
    expect(sent[0]!.params.link).toContain(`/admin/abuse-reports/${open.id}`);
    expect(email.sent.filter((m) => m.to === reporter.email)).toHaveLength(0);
  });

  it('a retry skips the super-admins already reminded (job progress)', async () => {
    const [sa1, sa2, reporter] = [
      await user('SUPER_ADMIN'),
      await user('SUPER_ADMIN'),
      await user(),
    ];
    const open = await report(reporter, 'OPEN');
    await expect(run(registry, open.id, { sentTo: [sa1.id] })).resolves.toEqual({ sent: 2 });
    expect(email.findByTemplate('abuse.minor_safety_reminder').map((m) => m.to)).toEqual([
      sa2.email,
    ]);
  });

  it('is a no-op once the report left OPEN, or when it no longer exists', async () => {
    await user('SUPER_ADMIN');
    const reporter = await user();
    const resolved = await report(reporter, 'RESOLVED');
    await run(registry, resolved.id);
    await run(registry, '0192f0f0-0000-7000-8000-000000000000');
    expect(email.sent).toHaveLength(0);
  });
});
