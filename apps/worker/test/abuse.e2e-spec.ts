import { Test, type TestingModule } from '@nestjs/testing';
import { QUEUES, defaultWorkspaceSettings, type AbuseCategory } from '@nibras/contracts';
import { resetDatabase, systemPrisma, type Locale, type User, type Workspace } from '@nibras/db';
import { InMemoryEmailProvider } from '@nibras/providers';
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
function user(
  platformRole: User['platformRole'] = 'NONE',
  o: Partial<Pick<User, 'locale' | 'firstName' | 'lastName' | 'status'>> = {},
): Promise<User> {
  n += 1;
  return db.user.create({
    data: {
      email: `worker-${n}-${Date.now()}@example.com`,
      firstName: 'W',
      lastName: 'User',
      platformRole,
      ...o,
    },
  });
}

/** A workspace whose owner and `members` have ACTIVE memberships. */
async function workspace(
  type: Workspace['type'],
  owner: User,
  members: [User, 'ADMIN' | 'TEACHER' | 'STUDENT'][] = [],
): Promise<Workspace> {
  n += 1;
  const ws = await db.workspace.create({
    data: {
      type,
      name: `Worker ws ${n}`,
      slug: `worker-ws-${n}-${Date.now()}`,
      ownerUserId: owner.id,
      defaultTimezone: 'Africa/Tunis',
      defaultLocale: 'fr',
      storageQuotaBytes: 1024n,
      settings: { ...defaultWorkspaceSettings('Africa/Tunis') },
    },
  });
  const all: [User, 'OWNER' | 'ADMIN' | 'TEACHER' | 'STUDENT'][] = [[owner, 'OWNER'], ...members];
  for (const [u, role] of all) {
    await db.membership.create({
      data: { workspaceId: ws.id, userId: u.id, role, status: 'ACTIVE' },
    });
  }
  return ws;
}

function newReport(reporter: User, reported: User, category: AbuseCategory, ws: Workspace | null) {
  return db.abuseReport.create({
    data: {
      workspaceId: ws?.id ?? null,
      reporterUserId: reporter.id,
      category,
      description: 'Comportement inapproprié pendant la session.',
      entityType: 'USER',
      entityId: reported.id,
      contextSnapshot: {},
      status: 'OPEN',
    },
  });
}

/** A BullMQ-like job whose `progress` survives between runs, as on a BullMQ retry. */
function createdJob(reportId: string) {
  const job = {
    name: 'abuse.report_created',
    id: `abuse:${reportId}:notify`,
    data: { reportId },
    progress: 0 as unknown,
    updateProgress(p: unknown) {
      job.progress = p;
      return Promise.resolve();
    },
  };
  return job;
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

describe('abuse.report_created processor (F12, AC-SAFE-02/05, Review Focus 5/6)', () => {
  let moduleRef: TestingModule;
  let registry: ProcessorRegistry;
  const email = new InMemoryEmailProvider();
  const origin = loadEnv().WEB_ORIGIN.replace(/\/+$/, '');

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [WorkerModule.register(loadEnv(), createLogger('silent'))],
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

  const dispatch = (job: ReturnType<typeof createdJob>) =>
    registry.dispatch(QUEUES.notifications, job as unknown as Job);
  const newReports = (to?: string) => email.findByTemplate('abuse.new_report', to);
  const link = (locale: Locale, path: string) => `${origin}/${locale}${path}`;

  it('organisation HARASSMENT: ack to the reporter, abuse.new_report to ACTIVE OWNER/ADMIN in their locale; never the reported user, never a super-admin, never the reporter named', async () => {
    const sa = await user('SUPER_ADMIN');
    const owner = await user('NONE', { locale: 'ar' });
    const admin = await user('NONE', { locale: 'en' });
    const suspendedAdmin = await user('NONE', { status: 'SUSPENDED' });
    const teacher = await user();
    const reporter = await user('NONE', { firstName: 'Zeynab', lastName: 'Qorchi' });
    const ws = await workspace('ORGANIZATION', owner, [
      [admin, 'ADMIN'],
      [suspendedAdmin, 'ADMIN'],
      [teacher, 'TEACHER'],
      [reporter, 'STUDENT'],
    ]);
    const r = await newReport(reporter, teacher, 'HARASSMENT', ws);

    await expect(dispatch(createdJob(r.id))).resolves.toEqual({ sent: 3 });

    const [ack] = email.findByTemplate('abuse.report_received', reporter.email);
    expect(ack!.params).toEqual({ firstName: 'Zeynab' });
    expect(email.sent[0]!.to).toBe(reporter.email); // the reporter first
    expect(
      newReports()
        .map((m) => m.to)
        .sort(),
    ).toEqual([owner.email, admin.email].sort());
    expect(newReports(owner.email)[0]!.locale).toBe('ar');
    expect(newReports(owner.email)[0]!.params.link).toBe(
      link('ar', `/app/w/${ws.id}/abuse-reports/${r.id}`),
    );
    expect(newReports(admin.email)[0]!.locale).toBe('en');
    expect(newReports(admin.email)[0]!.params.link).toBe(
      link('en', `/app/w/${ws.id}/abuse-reports/${r.id}`),
    );
    for (const nobody of [sa, teacher, suspendedAdmin]) {
      expect(email.sent.filter((m) => m.to === nobody.email)).toHaveLength(0);
    }
    // Owner Q1, Review Focus 6: no handler email names the reporter.
    for (const m of newReports()) {
      const body = JSON.stringify([m.subject, m.html, m.text, m.params]);
      for (const secret of [reporter.id, reporter.email, 'Zeynab', 'Qorchi']) {
        expect(body).not.toContain(secret);
      }
    }
  });

  it('MINOR_SAFETY: super-admins added with the admin link; an org admin who is also super-admin gets one email, with the admin link', async () => {
    const sa = await user('SUPER_ADMIN', { locale: 'en' });
    const owner = await user();
    const adminSa = await user('SUPER_ADMIN');
    const teacher = await user();
    const reporter = await user();
    const ws = await workspace('ORGANIZATION', owner, [
      [adminSa, 'ADMIN'],
      [teacher, 'TEACHER'],
      [reporter, 'STUDENT'],
    ]);
    const r = await newReport(reporter, teacher, 'MINOR_SAFETY', ws);

    await expect(dispatch(createdJob(r.id))).resolves.toEqual({ sent: 4 });
    expect(newReports(owner.email).map((m) => m.params.link)).toEqual([
      link('fr', `/app/w/${ws.id}/abuse-reports/${r.id}`),
    ]);
    expect(newReports(sa.email).map((m) => m.params.link)).toEqual([
      link('en', `/admin/abuse-reports/${r.id}`),
    ]);
    expect(newReports(adminSa.email).map((m) => m.params.link)).toEqual([
      link('fr', `/admin/abuse-reports/${r.id}`),
    ]);
    expect(email.sent.filter((m) => m.to === teacher.email)).toHaveLength(0);
  });

  it('the reported user is the only handler → super-admins only; a reported admin escalates and gets nothing', async () => {
    const sa = await user('SUPER_ADMIN');
    const owner = await user();
    const reporter = await user();
    const ws = await workspace('ORGANIZATION', owner, [[reporter, 'STUDENT']]);
    const r = await newReport(reporter, owner, 'HARASSMENT', ws);
    await dispatch(createdJob(r.id));
    expect(newReports().map((m) => m.to)).toEqual([sa.email]);
    expect(newReports(sa.email)[0]!.params.link).toBe(link('fr', `/admin/abuse-reports/${r.id}`));
    expect(email.sent.filter((m) => m.to === owner.email)).toHaveLength(0);

    email.clear();
    const owner2 = await user();
    const admin2 = await user();
    const ws2 = await workspace('ORGANIZATION', owner2, [
      [admin2, 'ADMIN'],
      [reporter, 'STUDENT'],
    ]);
    const r2 = await newReport(reporter, admin2, 'HARASSMENT', ws2);
    await dispatch(createdJob(r2.id));
    expect(
      newReports()
        .map((m) => m.to)
        .sort(),
    ).toEqual([sa.email, owner2.email].sort());
    expect(email.sent.filter((m) => m.to === admin2.email)).toHaveLength(0);
  });

  it('personal workspace or no workspace → super-admins only (plus the acknowledgement)', async () => {
    const sa = await user('SUPER_ADMIN');
    const solo = await user();
    const pupil = await user();
    const personal = await workspace('PERSONAL', solo, [[pupil, 'STUDENT']]);
    const r = await newReport(pupil, solo, 'HARASSMENT', personal);
    await expect(dispatch(createdJob(r.id))).resolves.toEqual({ sent: 2 });
    expect(newReports().map((m) => m.to)).toEqual([sa.email]);
    expect(email.findByTemplate('abuse.report_received', pupil.email)).toHaveLength(1);

    email.clear();
    const r2 = await newReport(pupil, solo, 'IMPERSONATION', null);
    await expect(dispatch(createdJob(r2.id))).resolves.toEqual({ sent: 2 });
    expect(newReports().map((m) => m.to)).toEqual([sa.email]);
    expect(newReports(sa.email)[0]!.params.link).toBe(link('fr', `/admin/abuse-reports/${r2.id}`));
  });

  it('retry: a failed recipient fails the job; the next attempt emails only that one, never the reporter again', async () => {
    const sa1 = await user('SUPER_ADMIN');
    const sa2 = await user('SUPER_ADMIN');
    const sa3 = await user('SUPER_ADMIN');
    const solo = await user();
    const pupil = await user();
    const personal = await workspace('PERSONAL', solo, [[pupil, 'STUDENT']]);
    const r = await newReport(pupil, solo, 'HARASSMENT', personal);
    const job = createdJob(r.id);

    email.failFor(sa2.email);
    await expect(dispatch(job)).rejects.toThrow(/1 email/);
    const { sentTo } = job.progress as { sentTo: string[] };
    expect([...sentTo].sort()).toEqual([pupil.id, sa1.id, sa3.id].sort());
    expect(email.sent.map((m) => m.to).sort()).toEqual([pupil.email, sa1.email, sa3.email].sort());

    email.clear(); // sa2's mailbox is reachable again
    await expect(dispatch(job)).resolves.toEqual({ sent: 4 });
    expect(email.sent.map((m) => m.to)).toEqual([sa2.email]);
  });

  it('unknown or malformed reportId → { sent: 0, skipped: "not_found" }', async () => {
    await user('SUPER_ADMIN');
    await expect(dispatch(createdJob('0192f0f0-0000-7000-8000-000000000000'))).resolves.toEqual({
      sent: 0,
      skipped: 'not_found',
    });
    await expect(dispatch(createdJob('nope'))).resolves.toEqual({ sent: 0, skipped: 'not_found' });
    expect(email.sent).toHaveLength(0);
  });
});
