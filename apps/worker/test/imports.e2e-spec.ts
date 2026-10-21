import { Writable } from 'node:stream';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  INVITATIONS_IMPORT_JOB,
  QUEUES,
  defaultWorkspaceSettings,
  hashOpaqueToken,
  importJobId,
} from '@nibras/contracts';
import {
  resetDatabase,
  systemPrisma,
  type InvitationImport,
  type PrismaClient,
  type User,
  type Workspace,
} from '@nibras/db';
import { InMemoryEmailProvider, extractFirstLink } from '@nibras/providers';
import type { Job } from 'bullmq';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/env';
import { EMAIL_PROVIDER } from '../src/providers';
import { ProcessorRegistry } from '../src/queues';
import { WORKER_DB, WorkerModule } from '../src/worker.module';
import { obliterateAllQueues } from './redis';

const db = systemPrisma();
const DAY = 24 * 60 * 60 * 1000;

let n = 0;
function user(o: Partial<Pick<User, 'locale' | 'firstName' | 'email'>> = {}): Promise<User> {
  n += 1;
  return db.user.create({
    data: {
      email: o.email ?? `importer-${n}-${Date.now()}@example.com`,
      firstName: o.firstName ?? `U${n}`,
      lastName: 'Import',
      locale: o.locale ?? 'fr',
    },
  });
}

async function workspace(
  owner: User,
  type: 'PERSONAL' | 'ORGANIZATION' = 'PERSONAL',
): Promise<Workspace> {
  n += 1;
  const ws = await db.workspace.create({
    data: {
      type,
      name: `Import ws ${n}`,
      slug: `import-ws-${n}-${Date.now()}`,
      ownerUserId: owner.id,
      defaultTimezone: 'Africa/Tunis',
      defaultLocale: 'fr',
      storageQuotaBytes: 1024n,
      settings: { ...defaultWorkspaceSettings('Africa/Tunis') },
    },
  });
  await db.membership.create({
    data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
  });
  return ws;
}

const address = (i: number) => `row-${i}@example.com`;

/** A QUEUED import of `count` valid rows (lines 2…count+1), as the API's confirm stores it. */
function createImport(ws: Workspace, by: User, count: number): Promise<InvitationImport> {
  const rows = Array.from({ length: count }, (_, i) => ({
    line: i + 2,
    email: address(i + 1),
    firstName: i % 2 ? `Prenom${i + 1}` : null,
    lastName: null,
    guardianEmail: null,
    birthDate: null,
    courseCodes: [],
  }));
  return db.invitationImport.create({
    data: {
      workspaceId: ws.id,
      createdByUserId: by.id,
      fileName: 'classe.csv',
      status: 'QUEUED',
      rows,
      report: [{ line: 200, email: 'bad', outcome: 'INVALID_EMAIL', message: 'Invalid email' }],
      totalRows: count + 1,
      validRows: count,
    },
  });
}

/** A BullMQ-like job whose `progress` survives between runs (stored as a copy), as on a retry. */
function fakeJob(imp: Pick<InvitationImport, 'id' | 'workspaceId'>) {
  const job = {
    name: INVITATIONS_IMPORT_JOB,
    id: importJobId(imp.id),
    data: { importId: imp.id, workspaceId: imp.workspaceId },
    attemptsMade: 0,
    opts: { attempts: 3 },
    progress: 0 as unknown,
    updateProgress(p: unknown) {
      job.progress = structuredClone(p);
      return Promise.resolve();
    },
  };
  return job;
}

function memorySink(): { sink: Writable; text: () => string } {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { sink, text: () => chunks.join('') };
}

type ReportRow = { line: number; email: string; outcome: string; message?: string };

/**
 * Replaces `obj[key]` (a Prisma delegate method of the worker's own client) until `restore()`.
 * `vi.spyOn` cannot be used: its restore leaves the delegate without the method.
 */
const restorers: (() => void)[] = [];
function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): void {
  const original = obj[key];
  const set = (value: unknown) =>
    Object.defineProperty(obj, key, { value, configurable: true, writable: true });
  set(impl);
  restorers.push(() => set(original));
}

describe('invitations.import_csv (AC-INV-07; Review Focus 5)', () => {
  let moduleRef: TestingModule;
  let registry: ProcessorRegistry;
  let workerDb: PrismaClient;
  const email = new InMemoryEmailProvider();
  const logs = memorySink();
  const origin = loadEnv().WEB_ORIGIN.replace(/\/+$/, '');

  const run = (job: ReturnType<typeof fakeJob>) =>
    registry.dispatch(QUEUES.imports, job as unknown as Job);
  const invites = () => email.findByTemplate('invitation.received_student');

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [WorkerModule.register(loadEnv(), pino({ level: 'info' }, logs.sink))],
    })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(email)
      .compile();
    await moduleRef.init();
    registry = moduleRef.get(ProcessorRegistry);
    workerDb = moduleRef.get(WORKER_DB);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await obliterateAllQueues();
  });

  afterEach(() => {
    while (restorers.length) restorers.pop()!();
  });

  beforeEach(async () => {
    await obliterateAllQueues();
    await resetDatabase(db);
    email.clear();
  });

  it('AC-INV-07 job: creates 95 PENDING invitations with hashed tokens, sends 95 emails with /invite/ links, COMPLETED, createdCount 95, imports.completed email, audit row', async () => {
    const owner = await user({ firstName: 'Mohamed', locale: 'ar' });
    const ws = await workspace(owner);
    // An existing account receives the invitation in its own locale.
    await user({ email: address(3), locale: 'en' });
    const imp = await createImport(ws, owner, 95);
    const job = fakeJob(imp);

    await expect(run(job)).resolves.toMatchObject({ created: 95, failed: 0 });

    const rows = await db.invitation.findMany({ where: { workspaceId: ws.id } });
    expect(rows).toHaveLength(95);
    for (const row of rows) {
      expect(row).toMatchObject({
        status: 'PENDING',
        role: 'STUDENT',
        invitedByUserId: owner.id,
        teacherUserId: null,
      });
      expect(+row.expiresAt - Date.now()).toBeGreaterThan(6.9 * DAY);
    }
    expect(invites()).toHaveLength(95);
    for (const mail of invites()) {
      const link = extractFirstLink(mail.html, '/invite/');
      expect(link).toMatch(new RegExp(`^${origin}/(fr|en)/invite/[A-Za-z0-9_-]{43}$`));
      const row = rows.find((r) => r.email === mail.to)!;
      expect(row.tokenHash).toBe(hashOpaqueToken(link!.split('/').pop()!));
      expect(mail.params).toMatchObject({ inviterName: 'Mohamed Import', workspaceName: ws.name });
    }
    expect(invites().find((m) => m.to === address(3))!.locale).toBe('en');
    expect(invites().find((m) => m.to === address(2))!.params).toMatchObject({
      hasName: 'yes',
      firstName: 'Prenom2',
    });

    const done = await db.invitationImport.findUniqueOrThrow({ where: { id: imp.id } });
    expect(done).toMatchObject({
      status: 'COMPLETED',
      processedRows: 95,
      createdCount: 95,
      failedCount: 0,
      error: null,
    });
    expect(done.startedAt).not.toBeNull();
    expect(done.finishedAt).not.toBeNull();
    const report = done.report as ReportRow[];
    expect(report).toHaveLength(96);
    expect(report.filter((r) => r.outcome === 'CREATED')).toHaveLength(95);
    expect(report.find((r) => r.line === 200)?.outcome).toBe('INVALID_EMAIL');
    expect(job.progress).toBe(95);

    const [completed] = email.findByTemplate('imports.completed', owner.email);
    expect(completed).toBeDefined();
    expect(completed!.locale).toBe('ar');
    expect(completed!.params).toEqual({
      firstName: 'Mohamed',
      workspaceName: ws.name,
      created: 95,
      failed: 0,
      link: `${origin}/ar/app/w/${ws.id}/students`,
    });

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'invitations.import_completed' },
    });
    expect(audit).toMatchObject({
      workspaceId: ws.id,
      actorUserId: null,
      actorRole: 'SYSTEM',
      entityType: 'InvitationImport',
      entityId: imp.id,
      requestId: `job:${importJobId(imp.id)}`,
    });
    expect(audit.after).toMatchObject({ createdCount: 95, failedCount: 0, processedRows: 95 });

    // Logs carry identifiers only: no address, no token.
    expect(logs.text()).not.toMatch(/row-\d+@example\.com/);
    expect(logs.text()).not.toContain(owner.email);
    expect(logs.text()).toContain(ws.id);

    // A second delivery of the same job is a no-op.
    await expect(run(fakeJob(imp))).resolves.toEqual({ skipped: 'not_runnable' });
    expect(invites()).toHaveLength(95);
  });

  it("Review Focus 5a: an email failure on row 41 (failFor) marks that row FAILED, the job completes with createdCount 95 and failedCount 1, the row's invitation exists and is resendable", async () => {
    const owner = await user();
    const ws = await workspace(owner);
    const imp = await createImport(ws, owner, 95);
    email.failFor(address(41));

    await expect(run(fakeJob(imp))).resolves.toMatchObject({ created: 95, failed: 1 });

    const done = await db.invitationImport.findUniqueOrThrow({ where: { id: imp.id } });
    expect(done).toMatchObject({
      status: 'COMPLETED',
      processedRows: 95,
      createdCount: 95,
      failedCount: 1,
    });
    const failed = (done.report as ReportRow[]).filter((r) => r.outcome === 'FAILED');
    expect(failed).toEqual([
      { line: 42, email: address(41), outcome: 'FAILED', message: expect.any(String) },
    ]);
    // The message names no address (the provider's error does).
    expect(failed[0]!.message).not.toContain('@');
    const invitation = await db.invitation.findFirstOrThrow({
      where: { workspaceId: ws.id, email: address(41) },
    });
    expect(invitation.status).toBe('PENDING');
    expect(invites()).toHaveLength(94);
    expect(email.findByTemplate('imports.completed')[0]!.params).toMatchObject({
      created: 95,
      failed: 1,
    });
    expect(logs.text()).not.toContain(address(41));
  });

  it('Review Focus 5b: a database error on row 41 fails the job at processedRows 40; the second run creates and emails rows 41–95 only; no address receives two emails; COMPLETED with createdCount 95', async () => {
    const owner = await user();
    const ws = await workspace(owner);
    const imp = await createImport(ws, owner, 95);
    const job = fakeJob(imp);

    const create = workerDb.invitation.create.bind(workerDb.invitation);
    let calls = 0;
    patch(workerDb.invitation, 'create', (args: Parameters<typeof create>[0]) => {
      calls += 1;
      if (calls === 41) return Promise.reject(new Error('connection reset'));
      return create(args);
    });

    await expect(run(job)).rejects.toThrow('connection reset');
    const mid = await db.invitationImport.findUniqueOrThrow({ where: { id: imp.id } });
    expect(mid).toMatchObject({ status: 'RUNNING', processedRows: 40, createdCount: 40 });
    expect(job.progress).toBe(40);
    expect(invites()).toHaveLength(40);
    expect(await db.invitation.count({ where: { workspaceId: ws.id } })).toBe(40);

    job.attemptsMade = 1;
    await expect(run(job)).resolves.toMatchObject({ created: 95, failed: 0 });
    expect(calls).toBe(41 + 55);

    const recipients = invites().map((m) => m.to);
    expect(recipients).toHaveLength(95);
    expect(new Set(recipients).size).toBe(95);
    expect(recipients.slice(40)).toEqual(Array.from({ length: 55 }, (_, i) => address(i + 41)));
    const done = await db.invitationImport.findUniqueOrThrow({ where: { id: imp.id } });
    expect(done).toMatchObject({
      status: 'COMPLETED',
      processedRows: 95,
      createdCount: 95,
      failedCount: 0,
    });
    const created = (done.report as ReportRow[]).filter((r) => r.outcome === 'CREATED');
    expect(created).toHaveLength(95);
    expect(new Set(created.map((r) => r.line)).size).toBe(95);
  });

  it('a retry after a crash between a send and its progress write finds the pending invitation: ALREADY_INVITED, never a second email', async () => {
    const owner = await user();
    const ws = await workspace(owner);
    const imp = await createImport(ws, owner, 3);
    const job = fakeJob(imp);
    const update = workerDb.invitationImport.updateMany.bind(workerDb.invitationImport);
    let calls = 0;
    patch(workerDb.invitationImport, 'updateMany', (args: Parameters<typeof update>[0]) => {
      calls += 1;
      // Call 1 marks the import RUNNING; call 3 records row 2.
      if (calls === 3) return Promise.reject(new Error('db down'));
      return update(args);
    });

    await expect(run(job)).rejects.toThrow('db down');
    expect(invites().map((m) => m.to)).toEqual([address(1), address(2)]);
    job.attemptsMade = 1;
    await expect(run(job)).resolves.toMatchObject({ created: 2, failed: 0 });
    expect(invites().map((m) => m.to)).toEqual([address(1), address(2), address(3)]);
    const done = await db.invitationImport.findUniqueOrThrow({ where: { id: imp.id } });
    expect((done.report as ReportRow[]).filter((r) => r.line < 200).map((r) => r.outcome)).toEqual([
      'CREATED',
      'ALREADY_INVITED',
      'CREATED',
    ]);
  });

  it('rows already invited/member at run time (invited between preview and run) → ALREADY_INVITED / ALREADY_MEMBER, nothing sent', async () => {
    const owner = await user();
    const ws = await workspace(owner);
    const imp = await createImport(ws, owner, 4);
    const member = await user({ email: address(1) });
    await db.membership.create({
      data: { workspaceId: ws.id, userId: member.id, role: 'STUDENT', status: 'ACTIVE' },
    });
    const removed = await user({ email: address(4) });
    await db.membership.create({
      data: { workspaceId: ws.id, userId: removed.id, role: 'STUDENT', status: 'REMOVED' },
    });
    await db.invitation.create({
      data: {
        workspaceId: ws.id,
        email: address(2),
        role: 'STUDENT',
        tokenHash: hashOpaqueToken(`raw-${Date.now()}`),
        expiresAt: new Date(Date.now() + DAY),
        status: 'PENDING',
        invitedByUserId: owner.id,
        lastSentAt: new Date(),
      },
    });
    // Pending in another workspace: irrelevant here.
    const other = await workspace(await user());
    await db.invitation.create({
      data: {
        workspaceId: other.id,
        email: address(3),
        role: 'STUDENT',
        tokenHash: hashOpaqueToken(`raw-other-${Date.now()}`),
        expiresAt: new Date(Date.now() + DAY),
        status: 'PENDING',
        invitedByUserId: owner.id,
        lastSentAt: new Date(),
      },
    });

    await expect(run(fakeJob(imp))).resolves.toMatchObject({ created: 2, failed: 0 });
    const done = await db.invitationImport.findUniqueOrThrow({ where: { id: imp.id } });
    expect(
      (done.report as ReportRow[]).filter((r) => r.line < 200).map((r) => [r.email, r.outcome]),
    ).toEqual([
      [address(1), 'ALREADY_MEMBER'],
      [address(2), 'ALREADY_INVITED'],
      [address(3), 'CREATED'],
      [address(4), 'CREATED'],
    ]);
    expect(done.createdCount).toBe(2);
    expect(invites().map((m) => m.to)).toEqual([address(3), address(4)]);
  });

  it('an organisation TEACHER importer is the teacher of the invitations; an ADMIN importer assigns nobody', async () => {
    const owner = await user();
    const ws = await workspace(owner, 'ORGANIZATION');
    const teacher = await user();
    const admin = await user();
    await db.membership.createMany({
      data: [
        { workspaceId: ws.id, userId: teacher.id, role: 'TEACHER', status: 'ACTIVE' },
        { workspaceId: ws.id, userId: admin.id, role: 'ADMIN', status: 'ACTIVE', canTeach: true },
      ],
    });
    const byTeacher = await createImport(ws, teacher, 1);
    await run(fakeJob(byTeacher));
    const byAdmin = await db.invitationImport.create({
      data: {
        workspaceId: ws.id,
        createdByUserId: admin.id,
        fileName: 'b.csv',
        status: 'QUEUED',
        rows: [{ line: 2, email: 'x@example.com', courseCodes: [] }],
        report: [],
        totalRows: 1,
        validRows: 1,
      },
    });
    await run(fakeJob(byAdmin));
    const rows = await db.invitation.findMany({ where: { workspaceId: ws.id } });
    expect(rows.find((r) => r.email === address(1))!.teacherUserId).toBe(teacher.id);
    expect(rows.find((r) => r.email === 'x@example.com')!.teacherUserId).toBeNull();
  });

  it('attempts exhausted → FAILED with error, then rethrows; unknown, foreign-workspace or finished imports are skipped', async () => {
    const owner = await user();
    const ws = await workspace(owner);
    const imp = await createImport(ws, owner, 2);
    patch(workerDb.invitation, 'create', () => Promise.reject(new Error('boom')));
    const job = fakeJob(imp);
    job.attemptsMade = 2;
    await expect(run(job)).rejects.toThrow('boom');
    const failed = await db.invitationImport.findUniqueOrThrow({ where: { id: imp.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toMatch(/Error/);
    expect(failed.finishedAt).not.toBeNull();
    while (restorers.length) restorers.pop()!();

    await expect(run(fakeJob(imp))).resolves.toEqual({ skipped: 'not_runnable' });
    const other = await workspace(await user());
    await expect(run(fakeJob({ id: imp.id, workspaceId: other.id }))).resolves.toEqual({
      skipped: 'not_found',
    });
    await expect(run(fakeJob({ id: 'nope', workspaceId: ws.id }))).resolves.toEqual({
      skipped: 'not_found',
    });
    expect(invites()).toEqual([]);
  });
});
