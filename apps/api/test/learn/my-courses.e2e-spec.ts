import type { PrismaClient } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestContext } from '../helpers/app';
import {
  addMember,
  createCourse,
  createEnrollment,
  createLesson,
  createModule,
  createOrganization,
  createPersonalWorkspace,
  createStudent,
  createUser,
} from '../helpers/factories';
import { agentOf, meCourses, meLesson } from './helpers';

describe('learn — my courses across workspaces (SP3 T10)', () => {
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

  it('lists ACTIVE enrollments of PUBLISHED and ARCHIVED courses in every workspace with teacher, workspace and progress, by last activity; the outline computes the next lesson', async () => {
    const teacherA = await createUser({ firstName: 'Amel', lastName: 'Ben Salah' });
    const a = await createPersonalWorkspace(teacherA, { name: 'Espace de Amel' });
    const owner = await createUser();
    const teacherB = await createUser({ firstName: 'Karim', lastName: 'Trabelsi' });
    const { workspace: b } = await createOrganization({
      owner,
      teachers: [teacherB],
      name: 'Lycée Pilote',
    });
    const { user: student } = await createStudent({ workspace: a });
    await addMember(b, student, 'STUDENT');
    const classmate = await createUser();

    // A: a published course with progress, a DRAFT one, a revoked one.
    const algebra = await createCourse(a, teacherA, { status: 'PUBLISHED', title: 'Algèbre' });
    const m1 = await createModule(algebra);
    const l1 = await createLesson(m1, { type: 'TEXT', estimatedMinutes: 15 });
    const l2 = await createLesson(m1, { type: 'TEXT', estimatedMinutes: 10 });
    await createEnrollment(algebra, student);
    const draft = await createCourse(a, teacherA, { status: 'DRAFT', title: 'Brouillon' });
    await createEnrollment(draft, student);
    const revoked = await createCourse(a, teacherA, { status: 'PUBLISHED', title: 'Retiré' });
    await createEnrollment(revoked, student, { status: 'REVOKED' });
    // B: an archived course (listed read-only), a deleted one, a classmate's course.
    const physics = await createCourse(b, teacherB, { status: 'ARCHIVED', title: 'Physique' });
    await createEnrollment(physics, student, { progressPercent: 40 });
    const deleted = await createCourse(b, teacherB, { status: 'ARCHIVED', title: 'Supprimé' });
    await createEnrollment(deleted, student);
    await db.course.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const notMine = await createCourse(b, teacherB, { status: 'PUBLISHED', title: 'Chimie' });
    await addMember(b, classmate, 'STUDENT');
    await createEnrollment(notMine, classmate);

    const s = await agentOf(ctx, student);
    // No activity yet: by title.
    let list = await s.get(meCourses()).expect(200);
    expect(list.body.items.map((i: { course: { id: string } }) => i.course.id)).toEqual([
      algebra.id,
      physics.id,
    ]);

    await s.post(meLesson(l1.id, '/complete')).expect(200);
    await db.enrollment.updateMany({
      where: { courseId: physics.id },
      data: { lastActivityAt: new Date(Date.now() - 86_400_000) },
    });
    list = await s.get(meCourses()).expect(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items[0]).toMatchObject({
      course: {
        id: algebra.id,
        title: 'Algèbre',
        coverUrl: null,
        language: 'fr',
        estimatedMinutes: 25,
        status: 'PUBLISHED',
        workspace: { id: a.id, name: 'Espace de Amel' },
        teacher: { firstName: 'Amel', lastName: 'Ben Salah' },
      },
      progressPercent: 50,
      completedAt: null,
      lastActivityAt: expect.any(String),
    });
    expect(list.body.items[1]).toMatchObject({
      course: {
        id: physics.id,
        status: 'ARCHIVED',
        estimatedMinutes: null,
        workspace: { id: b.id, name: 'Lycée Pilote' },
        teacher: { firstName: 'Karim', lastName: 'Trabelsi' },
      },
      progressPercent: 40,
    });

    const outline = await s.get(meCourses(`/${algebra.id}`)).expect(200);
    expect(outline.body).toMatchObject({
      course: { id: algebra.id, sequentialLessons: false, description: null },
      progressPercent: 50,
      next: { lessonId: l2.id },
    });
    expect(outline.body.modules[0].lessons[0]).toMatchObject({
      id: l1.id,
      progress: { status: 'COMPLETED' },
      locked: false,
    });
    expect(outline.body.modules[0].lessons[1].progress).toEqual({
      status: 'NOT_STARTED',
      completedAt: null,
    });
    // The archived course stays readable.
    const archived = await s.get(meCourses(`/${physics.id}`)).expect(200);
    expect(archived.body).toMatchObject({
      course: { status: 'ARCHIVED' },
      modules: [],
      next: null,
    });

    // Membership no longer ACTIVE in B: its courses leave the list.
    await db.membership.updateMany({
      where: { workspaceId: b.id, userId: student.id },
      data: { status: 'PENDING_APPROVAL' },
    });
    list = await s.get(meCourses()).expect(200);
    expect(list.body.items.map((i: { course: { id: string } }) => i.course.id)).toEqual([
      algebra.id,
    ]);
  });
});
