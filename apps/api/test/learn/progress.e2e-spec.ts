import type { PrismaClient } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestContext } from '../helpers/app';
import {
  createCourse,
  createEnrollment,
  createLesson,
  createMediaAsset,
  createModule,
  createPersonalWorkspace,
  createStudent,
  createUser,
} from '../helpers/factories';
import { agentOf, meLesson } from './helpers';

describe('learn — manual completion and progress percent (SP3 T10, D-P8 subset)', () => {
  let ctx: TestContext;
  let db: PrismaClient;

  beforeAll(async () => {
    ctx = await createTestApp();
    ({ db } = ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  it('opened → IN_PROGRESS; complete a PDF before opening → 409 LESSON_NOT_OPENED; complete → COMPLETED and Enrollment.progressPercent 50 (1 of 2 required, optional ignored); uncomplete → back; completedAt set at 100 and kept after uncomplete; lastActivityAt updated', async () => {
    const teacher = await createUser();
    const workspace = await createPersonalWorkspace(teacher);
    const { user: student } = await createStudent({ workspace });
    const course = await createCourse(workspace, teacher, { status: 'PUBLISHED' });
    const m1 = await createModule(course);
    const pdf = await createMediaAsset(workspace, teacher, { kind: 'PDF' });
    const pdfLesson = await createLesson(m1, { type: 'PDF', mediaAsset: pdf });
    const text = await createLesson(m1, { type: 'TEXT' });
    const optionalLesson = await createLesson(m1, { type: 'TEXT', isRequired: false });
    const m2 = await createModule(course, { isOptional: true });
    const optionalModuleLesson = await createLesson(m2, { type: 'TEXT' });
    const enrollment = await createEnrollment(course, student);
    const s = await agentOf(ctx, student);
    const readEnrollment = () => db.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } });

    await s
      .post(meLesson(pdfLesson.id, '/complete'))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('LESSON_NOT_OPENED'));
    expect((await readEnrollment()).lastActivityAt).toBeNull();

    const opened = await s.post(meLesson(pdfLesson.id, '/opened')).expect(200);
    expect(opened.body).toEqual({
      lesson: { id: pdfLesson.id, status: 'IN_PROGRESS', completedAt: null },
      course: { progressPercent: 0, completedAt: null },
    });
    const firstActivity = (await readEnrollment()).lastActivityAt!;
    expect(firstActivity).toBeInstanceOf(Date);

    const done = await s.post(meLesson(pdfLesson.id, '/complete')).expect(200);
    expect(done.body.lesson).toMatchObject({ status: 'COMPLETED' });
    expect(done.body.lesson.completedAt).toEqual(expect.any(String));
    expect(done.body.course).toEqual({ progressPercent: 50, completedAt: null });
    expect(
      await db.lessonProgress.findFirstOrThrow({
        where: { lessonId: pdfLesson.id, studentUserId: student.id },
      }),
    ).toMatchObject({ status: 'COMPLETED', completedManually: true, workspaceId: workspace.id });
    const afterComplete = await readEnrollment();
    expect(afterComplete.progressPercent).toBe(50);
    expect(afterComplete.lastActivityAt!.getTime()).toBeGreaterThanOrEqual(firstActivity.getTime());

    // Re-opening a completed lesson keeps it completed.
    const reopened = await s.post(meLesson(pdfLesson.id, '/opened')).expect(200);
    expect(reopened.body.lesson.status).toBe('COMPLETED');

    // Optional lessons and optional modules never count.
    await s.post(meLesson(optionalLesson.id, '/complete')).expect(200);
    const opt = await s.post(meLesson(optionalModuleLesson.id, '/complete')).expect(200);
    expect(opt.body.course.progressPercent).toBe(50);

    const full = await s.post(meLesson(text.id, '/complete')).expect(200);
    expect(full.body.course.progressPercent).toBe(100);
    const completedAt = full.body.course.completedAt as string;
    expect(completedAt).toEqual(expect.any(String));

    const undone = await s.post(meLesson(text.id, '/uncomplete')).expect(200);
    expect(undone.body).toEqual({
      lesson: { id: text.id, status: 'IN_PROGRESS', completedAt: null },
      course: { progressPercent: 50, completedAt },
    });
    const final = await readEnrollment();
    expect(final.progressPercent).toBe(50);
    expect(final.completedAt?.toISOString()).toBe(completedAt);
    expect(
      await db.lessonProgress.findFirstOrThrow({
        where: { lessonId: text.id, studentUserId: student.id },
      }),
    ).toMatchObject({ status: 'IN_PROGRESS', completedManually: false, completedAt: null });

    // Archived: read-only for enrolled students, progress frozen (PRD §8.4.1).
    await db.course.update({ where: { id: course.id }, data: { status: 'ARCHIVED' } });
    await s.get(meLesson(text.id)).expect(200);
    await s
      .post(meLesson(text.id, '/complete'))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('COURSE_STATUS_INVALID'));
    const frozen = await s.post(meLesson(text.id, '/opened')).expect(200);
    expect(frozen.body.course.progressPercent).toBe(50);
    expect((await readEnrollment()).updatedAt).toEqual(final.updatedAt);
  });
});
