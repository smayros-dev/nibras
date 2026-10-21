import { Test, type TestingModule } from '@nestjs/testing';
import {
  COURSE_ASSIGNED_NOTIFY_JOB,
  COURSE_PUBLISHED_NOTIFY_JOB,
  QUEUES,
  defaultWorkspaceSettings,
} from '@nibras/contracts';
import {
  resetDatabase,
  systemPrisma,
  type Course,
  type Locale,
  type MembershipStatus,
  type User,
  type Workspace,
} from '@nibras/db';
import { InMemoryEmailProvider, type EmailMessage, type EmailTemplateKey } from '@nibras/providers';
import type { Job } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { EMAIL_PROVIDER } from '../src/providers';
import { ProcessorRegistry } from '../src/queues';
import { WorkerModule } from '../src/worker.module';
import { obliterateAllQueues } from './redis';

const db = systemPrisma();

/** The in-memory provider, with failures that can be lifted without losing the sent mails. */
class FlakyEmail extends InMemoryEmailProvider {
  readonly down = new Set<string>();

  override send<K extends EmailTemplateKey>(msg: EmailMessage<K>) {
    if (this.down.has(msg.to)) return Promise.reject(new Error(`send to ${msg.to} failed`));
    return super.send(msg);
  }
}

let n = 0;
function user(firstName: string, locale: Locale = 'fr'): Promise<User> {
  n += 1;
  return db.user.create({
    data: {
      email: `notify-${n}-${Date.now()}@example.com`,
      firstName,
      lastName: 'Test',
      locale,
    },
  });
}

async function setup() {
  const teacher = await db.user.create({
    data: {
      email: `teacher-${Date.now()}@example.com`,
      firstName: 'Mohamed',
      lastName: 'Ben Ali',
    },
  });
  const ws: Workspace = await db.workspace.create({
    data: {
      type: 'PERSONAL',
      name: 'Espace de Mohamed',
      slug: `notify-ws-${Date.now()}`,
      ownerUserId: teacher.id,
      defaultTimezone: 'Africa/Tunis',
      defaultLocale: 'fr',
      storageQuotaBytes: 1024n,
      settings: { ...defaultWorkspaceSettings('Africa/Tunis') },
    },
  });
  await db.membership.create({
    data: { workspaceId: ws.id, userId: teacher.id, role: 'OWNER', status: 'ACTIVE' },
  });
  const course = await db.course.create({
    data: {
      workspaceId: ws.id,
      ownerUserId: teacher.id,
      title: 'Algèbre — niveau 1',
      language: 'fr',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });
  return { teacher, ws, course };
}

async function student(
  ws: Workspace,
  firstName: string,
  o: { locale?: Locale; status?: MembershipStatus } = {},
): Promise<User> {
  const u = await user(firstName, o.locale);
  await db.membership.create({
    data: { workspaceId: ws.id, userId: u.id, role: 'STUDENT', status: o.status ?? 'ACTIVE' },
  });
  return u;
}

function enroll(course: Course, u: User, status: 'ACTIVE' | 'REVOKED' = 'ACTIVE') {
  return db.enrollment.create({
    data: {
      workspaceId: course.workspaceId,
      courseId: course.id,
      studentUserId: u.id,
      status,
      assignedByUserId: course.ownerUserId,
      source: 'MANUAL',
      activatedAt: new Date(),
      ...(status === 'REVOKED' && { revokedAt: new Date() }),
    },
  });
}

/** A BullMQ-like job whose `progress` survives between runs, as on a retry. */
function job<T>(name: string, data: T) {
  const j = {
    name,
    id: `${name}:test`,
    data,
    progress: 0 as unknown,
    updateProgress(p: unknown) {
      j.progress = structuredClone(p);
      return Promise.resolve();
    },
  };
  return j;
}

describe('course notifications: course.assigned / course.published emails (SP3 T9)', () => {
  let moduleRef: TestingModule;
  let registry: ProcessorRegistry;
  const email = new FlakyEmail();

  const run = (j: { name: string }) => registry.dispatch(QUEUES.notifications, j as unknown as Job);

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
    email.down.clear();
  });

  it("assigned → one email per active enrollment naming course, teacher and workspace in the student's locale; a revoked enrollment, an inactive member or an unpublished course is skipped", async () => {
    const { ws, course } = await setup();
    const amel = await student(ws, 'Amel');
    const sami = await student(ws, 'Sami', { locale: 'ar' });
    const gone = await student(ws, 'Gone');
    const minor = await student(ws, 'Minor', { status: 'PENDING_GUARDIAN_CONSENT' });
    const e1 = await enroll(course, amel);
    const e2 = await enroll(course, sami);
    const e3 = await enroll(course, gone, 'REVOKED');
    const e4 = await enroll(course, minor);

    const result = await run(
      job(COURSE_ASSIGNED_NOTIFY_JOB, {
        workspaceId: ws.id,
        enrollmentIds: [e1.id, e2.id, e3.id, e4.id, '00000000-0000-7000-8000-000000000000'],
      }),
    );
    expect(result).toEqual({ sent: 2 });
    const mails = email.findByTemplate('course.assigned');
    expect(mails.map((m) => m.to).sort()).toEqual([amel.email, sami.email].sort());
    const toAmel = mails.find((m) => m.to === amel.email)!;
    expect(toAmel.locale).toBe('fr');
    expect(toAmel.params).toEqual({
      firstName: 'Amel',
      courseTitle: 'Algèbre — niveau 1',
      teacherName: 'Mohamed Ben Ali',
      workspaceName: 'Espace de Mohamed',
      link: `${loadEnv().WEB_ORIGIN.replace(/\/+$/, '')}/fr/app/courses/${course.id}`,
    });
    expect(mails.find((m) => m.to === sami.email)!.locale).toBe('ar');

    // The ids of another workspace are never read through this job's workspace.
    const other = await setup();
    const stranger = await student(other.ws, 'Stranger');
    const foreign = await enroll(other.course, stranger);
    email.clear();
    expect(
      await run(
        job(COURSE_ASSIGNED_NOTIFY_JOB, { workspaceId: ws.id, enrollmentIds: [foreign.id] }),
      ),
    ).toEqual({ sent: 0 });

    // Unpublished at run time → nothing.
    await db.course.update({ where: { id: course.id }, data: { status: 'DRAFT' } });
    expect(
      await run(job(COURSE_ASSIGNED_NOTIFY_JOB, { workspaceId: ws.id, enrollmentIds: [e1.id] })),
    ).toEqual({ sent: 0 });
    expect(email.sent).toEqual([]);
  });

  it('published → every ACTIVE enrollment of the course gets course.published; a course no longer PUBLISHED at run time → no-op', async () => {
    const { ws, course } = await setup();
    const amel = await student(ws, 'Amel');
    const sami = await student(ws, 'Sami');
    const gone = await student(ws, 'Gone');
    await enroll(course, amel);
    await enroll(course, sami);
    await enroll(course, gone, 'REVOKED');

    const result = await run(
      job(COURSE_PUBLISHED_NOTIFY_JOB, { workspaceId: ws.id, courseId: course.id }),
    );
    expect(result).toEqual({ sent: 2 });
    const mails = email.findByTemplate('course.published');
    expect(mails.map((m) => m.to).sort()).toEqual([amel.email, sami.email].sort());
    expect(mails[0]!.params).toMatchObject({
      courseTitle: 'Algèbre — niveau 1',
      teacherName: 'Mohamed Ben Ali',
      workspaceName: 'Espace de Mohamed',
    });

    email.clear();
    await db.course.update({ where: { id: course.id }, data: { status: 'DRAFT' } });
    expect(
      await run(job(COURSE_PUBLISHED_NOTIFY_JOB, { workspaceId: ws.id, courseId: course.id })),
    ).toEqual({ sent: 0, skipped: 'not_published' });
    await db.course.update({
      where: { id: course.id },
      data: { status: 'PUBLISHED', deletedAt: new Date() },
    });
    expect(
      await run(job(COURSE_PUBLISHED_NOTIFY_JOB, { workspaceId: ws.id, courseId: course.id })),
    ).toEqual({ sent: 0, skipped: 'not_published' });
    expect(
      await run(job(COURSE_PUBLISHED_NOTIFY_JOB, { workspaceId: ws.id, courseId: 'nope' })),
    ).toEqual({ sent: 0, skipped: 'not_published' });
    expect(email.sent).toEqual([]);
  });

  it('a failed send fails the job after trying everyone; the retry emails the rest once (sentTo)', async () => {
    const { ws, course } = await setup();
    const amel = await student(ws, 'Amel');
    const bilel = await student(ws, 'Bilel');
    const chiraz = await student(ws, 'Chiraz');
    await enroll(course, amel);
    await enroll(course, bilel);
    await enroll(course, chiraz);

    email.down.add(bilel.email);
    const j = job(COURSE_PUBLISHED_NOTIFY_JOB, { workspaceId: ws.id, courseId: course.id });
    await expect(run(j)).rejects.toThrow(/1 email/);
    expect(
      email
        .findByTemplate('course.published')
        .map((m) => m.to)
        .sort(),
    ).toEqual([amel.email, chiraz.email].sort());

    email.down.clear();
    expect(await run(j)).toEqual({ sent: 1 });
    const all = email.findByTemplate('course.published').map((m) => m.to);
    expect(all).toHaveLength(3);
    expect(new Set(all)).toEqual(new Set([amel.email, bilel.email, chiraz.email]));

    // The assigned job resumes the same way (keyed by enrollment).
    const e = await db.enrollment.findMany({ where: { courseId: course.id } });
    email.clear();
    email.down.add(amel.email);
    const a = job(COURSE_ASSIGNED_NOTIFY_JOB, {
      workspaceId: ws.id,
      enrollmentIds: e.map((x) => x.id),
    });
    await expect(run(a)).rejects.toThrow(/1 email/);
    email.down.clear();
    expect(await run(a)).toEqual({ sent: 1 });
    expect(email.findByTemplate('course.assigned')).toHaveLength(3);
  });
});
