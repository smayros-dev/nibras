import type { Lesson } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestContext } from '../helpers/app';
import {
  createCourse,
  createEnrollment,
  createLesson,
  createModule,
  createPersonalWorkspace,
  createStudent,
  createUser,
} from '../helpers/factories';
import { agentOf, meCourses, meLesson } from './helpers';

describe('learn — module and sequential locks (SP3 T10, PRD §8.5.2, Review Focus 4)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  async function setup(sequentialLessons = false) {
    const teacher = await createUser();
    const workspace = await createPersonalWorkspace(teacher);
    const { user: student } = await createStudent({ workspace });
    const course = await createCourse(workspace, teacher, {
      status: 'PUBLISHED',
      sequentialLessons,
    });
    return { teacher, workspace, student, course, s: await agentOf(ctx, student) };
  }

  it('PREVIOUS_MODULE_COMPLETED: module 1 at 80 % (4/5 required completed) → opening a module-2 lesson is 403 MODULE_LOCKED { reason: PREVIOUS_MODULE_INCOMPLETE, previousModule: { percent: 80 } }; completing the 5th unlocks (AC-ENR-03)', async () => {
    const { student, course, s } = await setup();
    const m1 = await createModule(course, { title: 'Les bases' });
    const lessons: Lesson[] = [];
    for (let i = 0; i < 5; i += 1) lessons.push(await createLesson(m1, { type: 'TEXT' }));
    const m2 = await createModule(course, { unlockRule: { type: 'PREVIOUS_MODULE_COMPLETED' } });
    const gated = await createLesson(m2, { type: 'TEXT' });
    await createEnrollment(course, student);

    for (const l of lessons.slice(0, 4)) await s.post(meLesson(l.id, '/complete')).expect(200);

    const lock = {
      reason: 'PREVIOUS_MODULE_INCOMPLETE',
      previousModule: { id: m1.id, title: 'Les bases', percent: 80 },
    };
    for (const req of [s.get(meLesson(gated.id)), s.post(meLesson(gated.id, '/opened'))]) {
      await req.expect(403).expect(({ body }) => {
        expect(body.code).toBe('MODULE_LOCKED');
        expect(body.details).toEqual(lock);
      });
    }
    await s.get(meLesson(gated.id, '/playback')).expect(403);
    await s.post(meLesson(gated.id, '/complete')).expect(403);

    // Locked content is still listed, with its reason.
    const outline = await s.get(meCourses(`/${course.id}`)).expect(200);
    expect(outline.body.modules[0]).toMatchObject({ id: m1.id, percent: 80, locked: false });
    expect(outline.body.modules[1]).toMatchObject({ id: m2.id, locked: true, lock });
    expect(outline.body.modules[1].lessons[0]).toMatchObject({ id: gated.id, locked: true, lock });
    expect(outline.body.next).toEqual({ lessonId: lessons[4]!.id });
    expect(outline.body.progressPercent).toBe(66);

    await s.post(meLesson(lessons[4]!.id, '/complete')).expect(200);
    await s.get(meLesson(gated.id)).expect(200);
    const unlocked = await s.get(meCourses(`/${course.id}`)).expect(200);
    expect(unlocked.body.modules[1]).toMatchObject({ locked: false, lock: null });
    expect(unlocked.body.next).toEqual({ lessonId: gated.id });
  });

  it('optional modules never gate; an optional lesson never blocks sequential lessons; sequential: lesson 2 → 403 LESSON_LOCKED until lesson 1 is COMPLETED (Review Focus 4)', async () => {
    const { student, course, s } = await setup(true);
    const m1 = await createModule(course);
    const l1 = await createLesson(m1, { type: 'TEXT', title: 'Introduction' });
    const optional = await createLesson(m1, { type: 'TEXT', isRequired: false });
    const l3 = await createLesson(m1, { type: 'TEXT' });
    const m2 = await createModule(course, { isOptional: true });
    await createLesson(m2, { type: 'TEXT' });
    const m3 = await createModule(course, { unlockRule: { type: 'PREVIOUS_MODULE_COMPLETED' } });
    const l31 = await createLesson(m3, { type: 'TEXT' });
    await createEnrollment(course, student);

    const lessonLock = {
      reason: 'PREVIOUS_LESSON_INCOMPLETE',
      previousLesson: { id: l1.id, title: 'Introduction' },
    };
    for (const lid of [optional.id, l3.id]) {
      await s
        .get(meLesson(lid))
        .expect(403)
        .expect(({ body }) => {
          expect(body.code).toBe('LESSON_LOCKED');
          expect(body.details).toEqual(lessonLock);
        });
    }
    await s.post(meLesson(l3.id, '/complete')).expect(403);

    await s.post(meLesson(l1.id, '/complete')).expect(200);
    // The optional lesson, left unfinished, does not block lesson 3.
    await s.get(meLesson(optional.id)).expect(200);
    await s.get(meLesson(l3.id)).expect(200);
    await s
      .get(meLesson(l31.id))
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe('MODULE_LOCKED');
        expect(body.details.previousModule).toMatchObject({ id: m1.id, percent: 50 });
      });

    await s.post(meLesson(l3.id, '/complete')).expect(200);
    // Module 2 is optional and untouched: module 3 still opens.
    await s.get(meLesson(l31.id)).expect(200);
    const outline = await s.get(meCourses(`/${course.id}`)).expect(200);
    expect(outline.body.modules.map((m: { percent: number }) => m.percent)).toEqual([100, 0, 0]);
    expect(outline.body.modules.map((m: { locked: boolean }) => m.locked)).toEqual([
      false,
      false,
      false,
    ]);
    expect(outline.body.next).toEqual({ lessonId: optional.id });
  });
});
