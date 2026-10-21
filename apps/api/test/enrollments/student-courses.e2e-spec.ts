import type { User } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StudentCoursesService } from '../../src/enrollments/student-courses.service';
import { createTestApp, type TestContext } from '../helpers/app';
import {
  createCourse,
  createEnrollment,
  createOrganization,
  createUser,
} from '../helpers/factories';

const S = 'JBSWY3DPEHPK3PXP';

/**
 * The students list / profile `courses` and `progressPercent` (spec §4.5, PRD §8.3.1). SP2's
 * students API is not on this branch yet: the service is exercised directly and wired into
 * `students.service.ts` after the SP2 merge.
 */
describe('StudentCoursesService: courses and progress of the students list and profile (SP3 T9)', () => {
  let ctx: TestContext;
  let service: StudentCoursesService;

  beforeAll(async () => {
    ctx = await createTestApp();
    service = ctx.app.get(StudentCoursesService);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  async function org() {
    const owner = await createUser({ totpSecret: S });
    const teacher = await createUser({ firstName: 'Teacher' });
    const teacher2 = await createUser({ firstName: 'Teacher2' });
    const amel = await createUser({ firstName: 'Amel' });
    const bilel = await createUser({ firstName: 'Bilel' });
    const chiraz = await createUser({ firstName: 'Chiraz' });
    const { workspace } = await createOrganization({
      owner,
      teachers: [teacher, teacher2],
      students: [amel, bilel, chiraz],
    });
    return { owner, teacher, teacher2, amel, bilel, chiraz, workspace };
  }

  it('students list and profile carry courses and progressPercent (mean of ACTIVE enrollments)', async () => {
    const { teacher, teacher2, amel, bilel, chiraz, workspace } = await org();
    const algebra = await createCourse(workspace, teacher, {
      status: 'PUBLISHED',
      title: 'Algèbre',
    });
    const physics = await createCourse(workspace, teacher2, {
      status: 'ARCHIVED',
      title: 'Physique',
    });
    const draft = await createCourse(workspace, teacher, { title: 'Brouillon' });
    const old = await createCourse(workspace, teacher, { status: 'PUBLISHED', title: 'Ancien' });
    const deleted = await createCourse(workspace, teacher, { status: 'PUBLISHED' });
    await ctx.db.course.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

    // Amel: 40 % and 75 % (published, archived) → 57; a DRAFT at 10 % and a REVOKED one are
    // listed but never averaged; a deleted course is not listed.
    await createEnrollment(algebra, amel, { progressPercent: 40 });
    await createEnrollment(physics, amel, { progressPercent: 75 });
    await createEnrollment(draft, amel, { progressPercent: 10 });
    await createEnrollment(old, amel, { status: 'REVOKED', progressPercent: 90 });
    await createEnrollment(deleted, amel, { progressPercent: 100 });
    // Bilel: only a DRAFT course → listed, progress null. Chiraz: nothing.
    await createEnrollment(draft, bilel);
    const completed = await createEnrollment(algebra, bilel, { status: 'REVOKED' });
    await ctx.db.enrollment.update({
      where: { id: completed.id },
      data: { completedAt: new Date('2026-10-01T10:00:00Z') },
    });

    const map = await service.forStudents(workspace.id, [amel.id, bilel.id, chiraz.id]);
    const a = map.get(amel.id)!;
    expect(a.progressPercent).toBe(57);
    expect(a.courses.map((c) => c.title)).toEqual(['Algèbre', 'Ancien', 'Brouillon', 'Physique']);
    expect(a.courses.find((c) => c.courseId === algebra.id)).toEqual({
      courseId: algebra.id,
      title: 'Algèbre',
      status: 'PUBLISHED',
      enrollmentStatus: 'ACTIVE',
      progressPercent: 40,
      completedAt: null,
    });
    expect(a.courses.find((c) => c.courseId === old.id)).toMatchObject({
      enrollmentStatus: 'REVOKED',
      progressPercent: 90,
    });
    const b = map.get(bilel.id)!;
    expect(b.progressPercent).toBeNull();
    expect(b.courses.find((c) => c.courseId === algebra.id)!.completedAt).toBe(
      '2026-10-01T10:00:00.000Z',
    );
    expect(map.get(chiraz.id)).toEqual({ courses: [], progressPercent: null });

    // The profile: one student; scope `own` (a TEACHER) → only his courses, mean over them.
    expect(await service.forStudent(workspace.id, amel.id)).toEqual(a);
    const own = await service.forStudent(workspace.id, amel.id, { ownerUserId: teacher.id });
    expect(own.courses.map((c) => c.title)).toEqual(['Algèbre', 'Ancien', 'Brouillon']);
    expect(own.progressPercent).toBe(40);
    expect(
      (await service.forStudent(workspace.id, amel.id, { ownerUserId: teacher2.id }))
        .progressPercent,
    ).toBe(75);
    expect(await service.forStudents(workspace.id, [])).toEqual(new Map());
  });

  it("never reads another workspace's enrollments", async () => {
    const a = await org();
    const b = await org();
    const bCourse = await createCourse(b.workspace, b.teacher, { status: 'PUBLISHED' });
    // The same user enrolled in B (a student of both organisations).
    const shared: User = a.amel;
    await ctx.db.membership.create({
      data: { workspaceId: b.workspace.id, userId: shared.id, role: 'STUDENT', status: 'ACTIVE' },
    });
    await createEnrollment(bCourse, shared, { progressPercent: 80 });
    expect(await service.forStudent(a.workspace.id, shared.id)).toEqual({
      courses: [],
      progressPercent: null,
    });
    expect((await service.forStudent(b.workspace.id, shared.id)).progressPercent).toBe(80);
  });
});
