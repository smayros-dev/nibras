import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  COURSE_ASSIGNED_NOTIFY_JOB,
  COURSE_PUBLISHED_NOTIFY_JOB,
  QUEUES,
  coursePublishedNotifyJobId,
} from '@nibras/contracts';
import type { Course, PrismaClient, User, Workspace } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  COURSE_ASSIGNED,
  COURSE_PUBLISHED,
  ENROLLMENT_REVOKED,
  type CourseAssignedEvent,
  type CoursePublishedEvent,
  type EnrollmentRevokedEvent,
} from '../../src/enrollments/events';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import {
  assign,
  createCourse,
  createEnrollment,
  createLesson,
  createModule,
  createOrganization,
  createPersonalWorkspace,
  createStudent,
  createUser,
} from '../helpers/factories';

const S = 'JBSWY3DPEHPK3PXP';

/** A teacher who passes `@RequireVerifiedTeacher()` (publish). */
const verifiedUser = (o: Parameters<typeof createUser>[0] = {}) =>
  createUser({ phoneVerified: true, consents: ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT'], ...o });

describe('enrollments: batch assign, revoke, re-assign, scopes (SP3 T9)', () => {
  let ctx: TestContext;
  let http: TestAgent;
  let db: PrismaClient;

  beforeAll(async () => {
    ctx = await createTestApp();
    ({ http, db } = ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  const agent = async (user: User) => as(http, (await loginAs(ctx, user)).cookie);
  const enrollments = (wid: string, cid: string, path = '') =>
    `/api/v1/workspaces/${wid}/courses/${cid}/enrollments${path}`;

  /** Collects the events of `name` emitted while `fn` runs (and the tick after). */
  async function capture<T>(name: string, fn: () => Promise<unknown>): Promise<T[]> {
    const seen: T[] = [];
    const emitter = ctx.app.get(EventEmitter2);
    const listener = (e: T) => seen.push(e);
    emitter.on(name, listener);
    try {
      await fn();
      await new Promise((r) => setImmediate(r));
    } finally {
      emitter.off(name, listener);
    }
    return seen;
  }

  async function personal(): Promise<{ teacher: User; workspace: Workspace }> {
    const teacher = await verifiedUser({ firstName: 'Mohamed', lastName: 'Ben Ali' });
    const workspace = await createPersonalWorkspace(teacher);
    return { teacher, workspace };
  }

  const student = async (workspace: Workspace, firstName: string) =>
    (await createStudent({ workspace, user: { firstName, lastName: 'Eleve' } })).user;

  const jobsNamed = (name: string) => ctx.queue.jobs.filter((j) => j.name === name);

  const auditRows = (action: string) =>
    db.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });

  it('assigning a PUBLISHED course creates ACTIVE enrollments, one notifications job with the ids, audit rows; re-assigning is idempotent (AC-ENR-01 data side)', async () => {
    const { teacher, workspace } = await personal();
    const course = await createCourse(workspace, teacher, { status: 'PUBLISHED' });
    const s1 = await student(workspace, 'Amel');
    const s2 = await student(workspace, 'Bilel');
    const a = await agent(teacher);

    let res!: Awaited<ReturnType<ReturnType<typeof a.post>['send']>>;
    const events = await capture<CourseAssignedEvent>(COURSE_ASSIGNED, async () => {
      res = await a
        .post(enrollments(workspace.id, course.id))
        .send({ studentUserIds: [s1.id, s2.id] })
        .expect(200);
    });
    expect(res.body).toEqual({
      items: [
        { studentUserId: s1.id, status: 'ACTIVE', created: true },
        { studentUserId: s2.id, status: 'ACTIVE', created: true },
      ],
    });
    const rows = await db.enrollment.findMany({
      where: { courseId: course.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        workspaceId: workspace.id,
        status: 'ACTIVE',
        source: 'MANUAL',
        assignedByUserId: teacher.id,
        progressPercent: 0,
        revokedAt: null,
      });
    }
    const ids = rows.map((r) => r.id).sort();
    const jobs = jobsNamed(COURSE_ASSIGNED_NOTIFY_JOB);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.queue).toBe(QUEUES.notifications);
    const data = jobs[0]!.data as { workspaceId: string; enrollmentIds: string[] };
    expect(data.workspaceId).toBe(workspace.id);
    expect([...data.enrollmentIds].sort()).toEqual(ids);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      workspaceId: workspace.id,
      courseId: course.id,
      assignedByUserId: teacher.id,
    });
    expect([...events[0]!.studentUserIds].sort()).toEqual([s1.id, s2.id].sort());

    const audits = await auditRows('enrollment.created');
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      entityType: 'Enrollment',
      workspaceId: workspace.id,
      actorUserId: teacher.id,
    });
    expect(audits.map((r) => r.entityId).sort()).toEqual(ids);
    expect(audits[0]!.after).toMatchObject({ courseId: course.id, source: 'MANUAL' });

    // Again, plus a third student: only the new one is created and notified.
    const s3 = await student(workspace, 'Chiraz');
    const again = await a
      .post(enrollments(workspace.id, course.id))
      .send({ studentUserIds: [s1.id, s3.id] })
      .expect(200);
    expect(again.body.items).toEqual([
      { studentUserId: s1.id, status: 'ACTIVE', created: false },
      { studentUserId: s3.id, status: 'ACTIVE', created: true },
    ]);
    expect(await db.enrollment.count({ where: { courseId: course.id } })).toBe(3);
    expect(jobsNamed(COURSE_ASSIGNED_NOTIFY_JOB)).toHaveLength(2);
    expect(
      (jobsNamed(COURSE_ASSIGNED_NOTIFY_JOB)[1]!.data as { enrollmentIds: string[] }).enrollmentIds,
    ).toHaveLength(1);
    expect(await auditRows('enrollment.created')).toHaveLength(3);

    // Nothing new at all → no job.
    await a
      .post(enrollments(workspace.id, course.id))
      .send({ studentUserIds: [s1.id, s2.id, s3.id] })
      .expect(200);
    expect(jobsNamed(COURSE_ASSIGNED_NOTIFY_JOB)).toHaveLength(2);

    // The list (enrollments and progress routes) names the students with their progress.
    const list = await a.get(enrollments(workspace.id, course.id)).expect(200);
    expect(list.body.nextCursor).toBeNull();
    expect(list.body.items).toHaveLength(3);
    expect(list.body.items[0]).toEqual({
      studentUserId: s1.id,
      firstName: 'Amel',
      lastName: 'Eleve',
      status: 'ACTIVE',
      source: 'MANUAL',
      activatedAt: expect.any(String),
      revokedAt: null,
      progressPercent: 0,
      completedAt: null,
      lastActivityAt: null,
    });
    const progress = await a
      .get(`/api/v1/workspaces/${workspace.id}/courses/${course.id}/progress`)
      .expect(200);
    expect(progress.body).toEqual(list.body);
    const page = await a.get(enrollments(workspace.id, course.id)).query({ limit: 2 }).expect(200);
    expect(page.body.items).toHaveLength(2);
    const next = await a
      .get(enrollments(workspace.id, course.id))
      .query({ limit: 2, cursor: page.body.nextCursor })
      .expect(200);
    expect(next.body.items.map((i: { studentUserId: string }) => i.studentUserId)).toEqual([s3.id]);
    expect(next.body.nextCursor).toBeNull();
    // A cursor that is not an enrollment of this course → 422 on cursor.
    const other = await createCourse(workspace, teacher);
    const foreign = await createEnrollment(other, s1);
    const bad = await a
      .get(enrollments(workspace.id, course.id))
      .query({ cursor: foreign.id })
      .expect(422);
    expect(bad.body.details.issues[0].path).toEqual(['cursor']);
  });

  it('assigning a DRAFT course creates enrollments but no job; publishing enqueues course.published_notify once per version (AC-ENR-02)', async () => {
    const { teacher, workspace } = await personal();
    const course = await createCourse(workspace, teacher);
    const module = await createModule(course);
    await createLesson(module, { type: 'TEXT' });
    const s1 = await student(workspace, 'Amel');
    const a = await agent(teacher);

    const assigned = await capture<CourseAssignedEvent>(COURSE_ASSIGNED, () =>
      a
        .post(enrollments(workspace.id, course.id))
        .send({ studentUserIds: [s1.id] })
        .expect(200),
    );
    expect(assigned).toEqual([]);
    expect(await db.enrollment.count({ where: { courseId: course.id, status: 'ACTIVE' } })).toBe(1);
    expect(jobsNamed(COURSE_ASSIGNED_NOTIFY_JOB)).toEqual([]);

    const published = await capture<CoursePublishedEvent>(COURSE_PUBLISHED, () =>
      a.post(`/api/v1/workspaces/${workspace.id}/courses/${course.id}/publish`).expect(200),
    );
    const version = (await db.course.findUniqueOrThrow({ where: { id: course.id } })).version;
    expect(published).toEqual([
      expect.objectContaining({ workspaceId: workspace.id, courseId: course.id, version }),
    ]);
    const jobs = jobsNamed(COURSE_PUBLISHED_NOTIFY_JOB);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      queue: QUEUES.notifications,
      data: { workspaceId: workspace.id, courseId: course.id },
      opts: { jobId: coursePublishedNotifyJobId(course.id, version) },
    });
    expect(jobsNamed(COURSE_ASSIGNED_NOTIFY_JOB)).toEqual([]);
  });

  it('revoke → REVOKED + event; re-assign → ACTIVE with progressPercent intact (AC-ENR-05)', async () => {
    const { teacher, workspace } = await personal();
    const course = await createCourse(workspace, teacher, { status: 'PUBLISHED' });
    const s1 = await student(workspace, 'Amel');
    const a = await agent(teacher);
    await a
      .post(enrollments(workspace.id, course.id))
      .send({ studentUserIds: [s1.id] })
      .expect(200);
    await db.enrollment.updateMany({
      where: { courseId: course.id, studentUserId: s1.id },
      data: { progressPercent: 40 },
    });
    ctx.queue.clear();

    const revoked = await capture<EnrollmentRevokedEvent>(ENROLLMENT_REVOKED, () =>
      a
        .delete(enrollments(workspace.id, course.id, `/${s1.id}`))
        .send({ reason: 'Fin du trimestre' })
        .expect(204),
    );
    expect(revoked).toEqual([
      expect.objectContaining({
        workspaceId: workspace.id,
        courseId: course.id,
        studentUserId: s1.id,
      }),
    ]);
    const row = await db.enrollment.findFirstOrThrow({ where: { courseId: course.id } });
    expect(row).toMatchObject({
      status: 'REVOKED',
      revokedReason: 'Fin du trimestre',
      progressPercent: 40,
    });
    expect(row.revokedAt).not.toBeNull();
    const audit = await auditRows('enrollment.revoked');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityId: row.id, actorUserId: teacher.id });
    expect(audit[0]!.before).toMatchObject({ status: 'ACTIVE' });
    expect(audit[0]!.after).toMatchObject({ status: 'REVOKED', reason: 'Fin du trimestre' });

    // Idempotent: a second revoke is 204 without a new audit row or event; no enrollment → 404.
    const twice = await capture<EnrollmentRevokedEvent>(ENROLLMENT_REVOKED, () =>
      a.delete(enrollments(workspace.id, course.id, `/${s1.id}`)).expect(204),
    );
    expect(twice).toEqual([]);
    expect(await auditRows('enrollment.revoked')).toHaveLength(1);
    const s2 = await student(workspace, 'Bilel');
    expect(
      (await a.delete(enrollments(workspace.id, course.id, `/${s2.id}`)).expect(404)).body.code,
    ).toBe('NOT_FOUND');
    await a.delete(enrollments(workspace.id, course.id, '/not-a-uuid')).expect(404);
    // A body with another key is refused by the strict schema.
    await a
      .delete(enrollments(workspace.id, course.id, `/${s1.id}`))
      .send({ studentUserId: s2.id })
      .expect(422);

    // Re-assign: ACTIVE again, progress kept, revocation cleared, notified again.
    const res = await a
      .post(enrollments(workspace.id, course.id))
      .send({ studentUserIds: [s1.id] })
      .expect(200);
    expect(res.body.items).toEqual([{ studentUserId: s1.id, status: 'ACTIVE', created: true }]);
    const back = await db.enrollment.findFirstOrThrow({ where: { courseId: course.id } });
    expect(back).toMatchObject({
      id: row.id,
      status: 'ACTIVE',
      progressPercent: 40,
      revokedAt: null,
      revokedReason: null,
    });
    expect(back.activatedAt.getTime()).toBeGreaterThanOrEqual(row.activatedAt.getTime());
    expect(jobsNamed(COURSE_ASSIGNED_NOTIFY_JOB)).toHaveLength(1);
    const created = await auditRows('enrollment.created');
    expect(created.at(-1)!.after).toMatchObject({ reactivated: true });
  });

  it("scope own: an org TEACHER can assign only his courses to students assigned to him (422 with the offending index); a non-student id → 422; ARCHIVED → 409; B's student → 422/404", async () => {
    const owner = await createUser({ totpSecret: S, firstName: 'Owner' });
    const teacher = await createUser({ firstName: 'Teacher' });
    const teacher2 = await createUser({ firstName: 'Teacher2' });
    const mine = await createUser({ firstName: 'Mine' });
    const notMine = await createUser({ firstName: 'NotMine' });
    const { workspace } = await createOrganization({
      owner,
      teachers: [teacher, teacher2],
      students: [mine, notMine],
    });
    await assign(workspace, teacher, mine, owner);
    const invited = (
      await createStudent({ workspace, invitedBy: teacher, user: { firstName: 'Invited' } })
    ).user;
    const minor = (
      await createStudent({
        workspace,
        status: 'PENDING_GUARDIAN_CONSENT',
        minor: true,
        invitedBy: teacher,
        user: { firstName: 'Minor' },
      })
    ).user;
    const pending = (
      await createStudent({ workspace, status: 'PENDING_APPROVAL', invitedBy: teacher })
    ).user;
    const course = await createCourse(workspace, teacher, { status: 'PUBLISHED' });
    const othersCourse = await createCourse(workspace, teacher2, { status: 'PUBLISHED' });
    const archived = await createCourse(workspace, teacher, { status: 'ARCHIVED' });
    const t = await agent(teacher);

    // Assigned, invited by him, and a consent-pending minor (pre-assigned, access waits).
    const ok = await t
      .post(enrollments(workspace.id, course.id))
      .send({ studentUserIds: [mine.id, invited.id, minor.id] })
      .expect(200);
    expect(ok.body.items).toHaveLength(3);

    // Not assigned to him (index 1), not a student (index 2), pending approval (index 3).
    const refused = await t
      .post(enrollments(workspace.id, course.id))
      .send({ studentUserIds: [mine.id, notMine.id, teacher2.id, pending.id] })
      .expect(422);
    expect(refused.body.code).toBe('VALIDATION_FAILED');
    expect(
      refused.body.details.issues
        .map((i: { path: unknown[] }) => i.path)
        .sort((x: unknown[], y: unknown[]) => (x[1] as number) - (y[1] as number)),
    ).toEqual([
      ['studentUserIds', 1],
      ['studentUserIds', 2],
      ['studentUserIds', 3],
    ]);
    expect(await db.enrollment.count({ where: { courseId: course.id } })).toBe(3);

    // Another teacher's course is invisible to him; ARCHIVED takes no new assignment.
    await t
      .post(enrollments(workspace.id, othersCourse.id))
      .send({ studentUserIds: [mine.id] })
      .expect(404);
    await t.get(enrollments(workspace.id, othersCourse.id)).expect(404);
    await t.delete(enrollments(workspace.id, othersCourse.id, `/${mine.id}`)).expect(404);
    const arch = await t
      .post(enrollments(workspace.id, archived.id))
      .send({ studentUserIds: [mine.id] })
      .expect(409);
    expect(arch.body).toMatchObject({
      code: 'COURSE_STATUS_INVALID',
      details: { status: 'ARCHIVED' },
    });

    // The OWNER (scope all) assigns any student of the workspace to any course.
    const o = await agent(owner);
    await o
      .post(enrollments(workspace.id, othersCourse.id))
      .send({ studentUserIds: [notMine.id, mine.id] })
      .expect(200);

    // A student of organisation B is not a student here.
    const bOwner = await createUser({ totpSecret: S });
    const bStudent = await createUser({ firstName: 'Beta' });
    const { workspace: b } = await createOrganization({ owner: bOwner, students: [bStudent] });
    const foreign = await o
      .post(enrollments(workspace.id, course.id))
      .send({ studentUserIds: [bStudent.id] })
      .expect(422);
    expect(foreign.body.details.issues[0].path).toEqual(['studentUserIds', 0]);
    expect(await db.enrollment.count({ where: { studentUserId: bStudent.id } })).toBe(0);
    // B's course from A → 404.
    const bCourse = await createCourse(b, bOwner, { status: 'PUBLISHED' });
    await o
      .post(enrollments(workspace.id, bCourse.id))
      .send({ studentUserIds: [mine.id] })
      .expect(404);

    // Duplicates and empty lists are refused by the contract; students get 403.
    await o
      .post(enrollments(workspace.id, course.id))
      .send({ studentUserIds: [mine.id, mine.id] })
      .expect(422);
    await o.post(enrollments(workspace.id, course.id)).send({ studentUserIds: [] }).expect(422);
    const s = await agent(mine);
    expect(
      (
        await s
          .post(enrollments(workspace.id, course.id))
          .send({ studentUserIds: [mine.id] })
          .expect(403)
      ).body.code,
    ).toBe('PERMISSION_DENIED');
    await s.get(enrollments(workspace.id, course.id)).expect(403);
  });

  it('a deleted course is 404 on every enrollment route', async () => {
    const { teacher, workspace } = await personal();
    const course: Course = await createCourse(workspace, teacher);
    const s1 = await student(workspace, 'Amel');
    await createEnrollment(course, s1);
    await db.course.update({ where: { id: course.id }, data: { deletedAt: new Date() } });
    const a = await agent(teacher);
    await a.get(enrollments(workspace.id, course.id)).expect(404);
    await a
      .post(enrollments(workspace.id, course.id))
      .send({ studentUserIds: [s1.id] })
      .expect(404);
    await a.delete(enrollments(workspace.id, course.id, `/${s1.id}`)).expect(404);
  });
});
