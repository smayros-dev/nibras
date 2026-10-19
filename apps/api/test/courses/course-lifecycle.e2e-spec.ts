import { COURSE_PUBLISHED_NOTIFY_JOB, QUEUES, coursePublishedNotifyJobId } from '@nibras/contracts';
import type { Course, PrismaClient, User, Workspace } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import {
  createCourse,
  createLesson,
  createMediaAsset,
  createModule,
  createOrganization,
  createPersonalWorkspace,
  createUser,
} from '../helpers/factories';
import { expectStructureInvariant } from '../helpers/invariants';

/** A teacher who passes `@RequireVerifiedTeacher()`: email, phone, code of conduct. */
const verifiedUser = (o: Parameters<typeof createUser>[0] = {}) =>
  createUser({ phoneVerified: true, consents: ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT'], ...o });

describe('course lifecycle: publish, unpublish, archive, restore, delete (SP3 T5)', () => {
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
  const courses = (wid: string, path = '') => `/api/v1/workspaces/${wid}/courses${path}`;

  async function personal(): Promise<{ teacher: User; workspace: Workspace }> {
    const teacher = await verifiedUser({ firstName: 'Mohamed' });
    const workspace = await createPersonalWorkspace(teacher);
    return { teacher, workspace };
  }

  async function enrol(course: Course, status: 'ACTIVE' | 'REVOKED' = 'ACTIVE') {
    const student = await createUser({ firstName: 'Eleve' });
    const enrollment = await db.enrollment.create({
      data: {
        workspaceId: course.workspaceId,
        courseId: course.id,
        studentUserId: student.id,
        status,
        assignedByUserId: course.ownerUserId,
        source: 'MANUAL',
        activatedAt: new Date(),
        ...(status === 'REVOKED' && { revokedAt: new Date() }),
      },
    });
    return { student, enrollment };
  }

  const status = async (id: string) =>
    (await db.course.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

  it('publish refuses a course without a READY lesson, listing the blockers (AC-CRS-01)', async () => {
    const { teacher, workspace } = await personal();
    const course = await createCourse(workspace, teacher);
    const a = await agent(teacher);
    const url = courses(workspace.id, `/${course.id}`);

    const res = await a.post(`${url}/publish`).expect(422);
    expect(res.body).toMatchObject({
      code: 'COURSE_NOT_PUBLISHABLE',
      details: { missing: ['NO_MODULE'] },
    });

    // A module whose only lesson's video is still processing.
    const module = await createModule(course);
    const processing = await createMediaAsset(workspace, teacher, {
      kind: 'VIDEO',
      status: 'PROCESSING',
    });
    const video = await createLesson(module, { type: 'VIDEO', mediaAsset: processing });
    const res2 = await a.post(`${url}/publish`).expect(422);
    expect(res2.body).toMatchObject({
      code: 'COURSE_NOT_PUBLISHABLE',
      details: { missing: ['NO_READY_LESSON'], lessons: [{ id: video.id, title: video.title }] },
    });
    await a
      .get(url)
      .expect(200)
      .expect(({ body }) => {
        expect(body.canPublish).toBe(false);
        expect(body.publishBlockers).toEqual(['NO_READY_LESSON']);
        expect(body.moduleCount).toBe(1);
        expect(body.lessonCount).toBe(1);
      });
    expect(await status(course.id)).toBe('DRAFT');
    expect(ctx.queue.jobs).toHaveLength(0);

    // A TEXT lesson is always ready.
    await createLesson(module, { type: 'TEXT', estimatedMinutes: 15 });
    await a
      .get(url)
      .expect(200)
      .expect(({ body }) => {
        expect(body.canPublish).toBe(true);
        expect(body.publishBlockers).toEqual([]);
        expect(body.estimatedMinutes).toBe(15);
      });
    const ok = await a.post(`${url}/publish`).expect(200).expect('ETag', '"2"');
    expect(ok.body).toMatchObject({ status: 'PUBLISHED', version: 2, canPublish: false });
    expect(Date.parse(ok.body.publishedAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(ctx.queue.jobs).toEqual([
      {
        queue: QUEUES.notifications,
        name: COURSE_PUBLISHED_NOTIFY_JOB,
        data: { workspaceId: workspace.id, courseId: course.id },
        opts: { jobId: coursePublishedNotifyJobId(course.id, 2) },
      },
    ]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'course.published' } });
    expect(audit).toMatchObject({ entityType: 'Course', entityId: course.id });
    expect(audit.before).toEqual({ status: 'DRAFT' });
    expect(audit.after).toEqual({ status: 'PUBLISHED' });
    await expectStructureInvariant(db, course.id);

    // An unverified teacher cannot publish (D-O6).
    const unverified = await createUser();
    const w2 = await createPersonalWorkspace(unverified);
    const c2 = await createCourse(w2, unverified);
    await (
      await agent(unverified)
    )
      .post(courses(w2.id, `/${c2.id}/publish`))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('TEACHER_NOT_VERIFIED'));
  });

  it('delete: PUBLISHED → 409 COURSE_STATUS_INVALID (hint ARCHIVE_FIRST); ARCHIVED with an ACTIVE enrollment → 409 COURSE_HAS_ACTIVE_ENROLLMENTS (AC-CRS-05); after revoking → 204, deletedAt set, course gone from the list', async () => {
    const { teacher, workspace } = await personal();
    const course = await createCourse(workspace, teacher, { status: 'PUBLISHED' });
    const { enrollment } = await enrol(course);
    await enrol(course, 'REVOKED');
    const a = await agent(teacher);
    const url = courses(workspace.id, `/${course.id}`);

    await a
      .delete(url)
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('COURSE_STATUS_INVALID');
        expect(body.details).toMatchObject({ status: 'PUBLISHED', hint: 'ARCHIVE_FIRST' });
      });
    await a
      .post(`${url}/archive`)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('ARCHIVED'));
    await a
      .delete(url)
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('COURSE_HAS_ACTIVE_ENROLLMENTS');
        expect(body.details).toEqual({ count: 1 });
      });
    expect((await db.course.findUniqueOrThrow({ where: { id: course.id } })).deletedAt).toBeNull();

    await db.enrollment.update({
      where: { id: enrollment.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    await a.delete(url).expect(204);
    const row = await db.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.status).toBe('ARCHIVED');
    await a
      .get(courses(workspace.id))
      .expect(200)
      .expect(({ body }) => expect(body.items).toEqual([]));
    await a.get(url).expect(404);
    await a.delete(url).expect(404);
    await a.post(`${url}/restore`).expect(404);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'course.deleted' } });
    expect(audit).toMatchObject({ entityType: 'Course', entityId: course.id });
    expect(audit.before).toEqual({ status: 'ARCHIVED' });

    // A DRAFT without enrollment goes straight away.
    const draft = await createCourse(workspace, teacher);
    await a.delete(courses(workspace.id, `/${draft.id}`)).expect(204);
  });

  it('transitions: unpublish keeps enrollments and progress rows (AC-CRS-02 data side); archive/restore; wrong source state → 409 COURSE_STATUS_INVALID; every transition audited', async () => {
    const { teacher, workspace } = await personal();
    const course = await createCourse(workspace, teacher, { status: 'PUBLISHED' });
    const module = await createModule(course);
    const lesson = await createLesson(module, { type: 'TEXT' });
    const { student, enrollment } = await enrol(course);
    await db.lessonProgress.create({
      data: {
        workspaceId: workspace.id,
        lessonId: lesson.id,
        studentUserId: student.id,
        status: 'COMPLETED',
        completedAt: new Date(),
        completedManually: true,
      },
    });
    const a = await agent(teacher);
    const url = courses(workspace.id, `/${course.id}`);
    const invalid = (from: string) => (res: { body: { code: string; details: unknown } }) => {
      expect(res.body.code).toBe('COURSE_STATUS_INVALID');
      expect(res.body.details).toMatchObject({ status: from });
    };

    await a.post(`${url}/restore`).expect(409).expect(invalid('PUBLISHED'));
    await a.post(`${url}/publish`).expect(409).expect(invalid('PUBLISHED'));
    await a
      .post(`${url}/unpublish`)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('DRAFT'));
    // Enrollment and progress untouched; no notification job.
    expect(await db.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } })).toEqual(
      enrollment,
    );
    expect(
      await db.lessonProgress.count({ where: { studentUserId: student.id, status: 'COMPLETED' } }),
    ).toBe(1);
    expect(ctx.queue.jobs).toHaveLength(0);

    await a.post(`${url}/unpublish`).expect(409).expect(invalid('DRAFT'));
    await a.post(`${url}/archive`).expect(409).expect(invalid('DRAFT'));
    await a.post(`${url}/restore`).expect(409).expect(invalid('DRAFT'));
    // A re-publication is a new notification (new version → new job id).
    const pub = await a.post(`${url}/publish`).expect(200);
    expect(ctx.queue.jobs.map((j) => j.opts?.jobId)).toEqual([
      coursePublishedNotifyJobId(course.id, pub.body.version as number),
    ]);
    await a
      .post(`${url}/archive`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('ARCHIVED');
        expect(body.archivedAt).not.toBeNull();
      });
    await a.post(`${url}/archive`).expect(409).expect(invalid('ARCHIVED'));
    await a.post(`${url}/publish`).expect(409).expect(invalid('ARCHIVED'));
    await a
      .post(`${url}/restore`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('PUBLISHED');
        expect(body.archivedAt).toBeNull();
      });
    // Restoring does not notify again.
    expect(ctx.queue.jobs).toHaveLength(1);

    const audits = await db.auditLog.findMany({
      where: { entityId: course.id, action: { startsWith: 'course.' } },
      orderBy: { createdAt: 'asc' },
      select: { action: true, before: true, after: true },
    });
    expect(audits).toEqual([
      { action: 'course.unpublished', before: { status: 'PUBLISHED' }, after: { status: 'DRAFT' } },
      { action: 'course.published', before: { status: 'DRAFT' }, after: { status: 'PUBLISHED' } },
      { action: 'course.archived', before: { status: 'PUBLISHED' }, after: { status: 'ARCHIVED' } },
      { action: 'course.restored', before: { status: 'ARCHIVED' }, after: { status: 'PUBLISHED' } },
    ]);
    // Every transition bumped the version (1 → 5).
    expect((await db.course.findUniqueOrThrow({ where: { id: course.id } })).version).toBe(5);
  });

  it('an org TEACHER cannot move or delete a colleague course (404); a SUSPENDED workspace refuses transitions (423)', async () => {
    const owner = await verifiedUser({ totpSecret: 'JBSWY3DPEHPK3PXP' });
    const t1 = await verifiedUser();
    const t2 = await verifiedUser();
    const { workspace } = await createOrganization({ owner, teachers: [t1, t2] });
    const course = await createCourse(workspace, t2, { status: 'PUBLISHED' });
    const a1 = await agent(t1);
    for (const action of ['unpublish', 'archive', 'restore', 'publish']) {
      await a1.post(courses(workspace.id, `/${course.id}/${action}`)).expect(404);
    }
    expect(await status(course.id)).toBe('PUBLISHED');

    await db.workspace.update({
      where: { id: workspace.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    await (await agent(t2)).post(courses(workspace.id, `/${course.id}/archive`)).expect(423);
    expect(await status(course.id)).toBe('PUBLISHED');
  });
});
