import type { Course, Module, PrismaClient, User, Workspace } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import {
  createCourse,
  createLesson,
  createModule,
  createPersonalWorkspace,
  createUser,
} from '../helpers/factories';
import { expectStructureInvariant } from '../helpers/invariants';

const TEXT = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bonjour' }] }],
};

describe('structure: reorder under deferred constraints, version races (SP3 T6)', () => {
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
  const ws = (wid: string, path: string) => `/api/v1/workspaces/${wid}${path}`;
  const version = async (cid: string) =>
    (await db.course.findUniqueOrThrow({ where: { id: cid } })).version;

  async function setup(): Promise<{
    teacher: User;
    workspace: Workspace;
    course: Course;
    modules: Module[];
  }> {
    const teacher = await createUser();
    const workspace = await createPersonalWorkspace(teacher);
    const course = await createCourse(workspace, teacher);
    const modules: Module[] = [];
    for (let i = 0; i < 3; i += 1) modules.push(await createModule(course));
    return { teacher, workspace, course, modules };
  }

  it('reorders 5 lessons in one transaction without a unique violation; positions 1..5; course version +1 (AC-CRS-04)', async () => {
    const { teacher, workspace, course, modules } = await setup();
    const mid = modules[0]!.id;
    const lessons = [];
    for (let i = 0; i < 5; i += 1) lessons.push(await createLesson(modules[0]!, { type: 'TEXT' }));
    const a = await agent(teacher);
    const v = await version(course.id);
    const moduleVersion = modules[0]!.version;

    const ids = lessons.map((l) => l.id).reverse();
    const res = await a
      .post(ws(workspace.id, `/modules/${mid}/lessons/reorder`))
      .set('If-Match', `"${v}"`)
      .send({ ids })
      .expect(200)
      .expect('ETag', `"${v + 1}"`);
    expect(res.body.lessons.map((l: { id: string }) => l.id)).toEqual(ids);
    expect(res.body.version).toBe(moduleVersion + 1);
    const rows = await db.lesson.findMany({
      where: { moduleId: mid },
      orderBy: { position: 'asc' },
    });
    expect(rows.map((r) => r.id)).toEqual(ids);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
    expect(await version(course.id)).toBe(v + 1);
    await expectStructureInvariant(db, course.id);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'lesson.reordered' } });
    expect(audit).toMatchObject({ entityType: 'Module', entityId: mid, workspaceId: workspace.id });
    expect(audit.after).toEqual({ ids });

    // Modules too: 3 → 1 → 2.
    const moduleIds = [modules[2]!.id, modules[0]!.id, modules[1]!.id];
    const structure = await a
      .post(ws(workspace.id, `/courses/${course.id}/modules/reorder`))
      .set('If-Match', `"${v + 1}"`)
      .send({ ids: moduleIds })
      .expect(200)
      .expect('ETag', `"${v + 2}"`);
    expect(structure.body.version).toBe(v + 2);
    expect(structure.body.modules.map((m: { id: string }) => m.id)).toEqual(moduleIds);
    expect(structure.body.modules.map((m: { position: number }) => m.position)).toEqual([1, 2, 3]);
    // The lessons follow their module.
    expect(structure.body.modules[1].lessons.map((l: { id: string }) => l.id)).toEqual(ids);
    await expectStructureInvariant(db, course.id);
    expect(await db.auditLog.count({ where: { action: 'module.reordered' } })).toBe(1);

    // GET structure carries the same order and the ETag.
    await a
      .get(ws(workspace.id, `/courses/${course.id}/structure`))
      .expect(200)
      .expect('ETag', `"${v + 2}"`)
      .expect(({ body }) => {
        expect(body.modules.map((m: { id: string }) => m.id)).toEqual(moduleIds);
      });
  });

  it('refuses a partial or foreign id set (422), keeps positions; If-Match is required (428) and checked (409)', async () => {
    const { teacher, workspace, course, modules } = await setup();
    const other = await createCourse(workspace, teacher, { title: 'Autre' });
    const otherModule = await createModule(other);
    const a = await agent(teacher);
    const url = ws(workspace.id, `/courses/${course.id}/modules/reorder`);
    const ids = modules.map((m) => m.id);

    for (const bad of [
      ids.slice(0, 2), // partial
      [...ids.slice(0, 2), otherModule.id], // another course's module
      [...ids, otherModule.id], // one too many
    ]) {
      const res = await a.post(url).set('If-Match', '"1"').send({ ids: bad }).expect(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details.issues[0].path).toEqual(['ids']);
    }
    // Duplicates are refused by the schema.
    await a
      .post(url)
      .set('If-Match', '"1"')
      .send({ ids: [ids[0], ids[0], ids[1]] })
      .expect(422);
    await a
      .post(url)
      .send({ ids: [...ids].reverse() })
      .expect(428)
      .expect(({ body }) => expect(body.code).toBe('VERSION_REQUIRED'));
    await a
      .post(url)
      .set('If-Match', '"7"')
      .send({ ids: [...ids].reverse() })
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 1 } }),
      );

    const rows = await db.module.findMany({
      where: { courseId: course.id },
      orderBy: { position: 'asc' },
    });
    expect(rows.map((r) => r.id)).toEqual(ids);
    expect(await version(course.id)).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'module.reordered' } })).toBe(0);

    // Lessons: a lesson of another module of the same course is refused.
    const l1 = await createLesson(modules[0]!, { type: 'TEXT' });
    const l2 = await createLesson(modules[0]!, { type: 'TEXT' });
    const elsewhere = await createLesson(modules[1]!, { type: 'TEXT' });
    await a
      .post(ws(workspace.id, `/modules/${modules[0]!.id}/lessons/reorder`))
      .set('If-Match', '"1"')
      .send({ ids: [l2.id, elsewhere.id] })
      .expect(422);
    expect(
      (
        await db.lesson.findMany({
          where: { moduleId: modules[0]!.id },
          orderBy: { position: 'asc' },
        })
      ).map((l) => l.id),
    ).toEqual([l1.id, l2.id]);
    await expectStructureInvariant(db, course.id);
  });

  it('two concurrent lesson creations with the same If-Match → one 201, one 409 (Review Focus 1)', async () => {
    const { teacher, workspace, course, modules } = await setup();
    const a = await agent(teacher);
    const url = ws(workspace.id, `/modules/${modules[0]!.id}/lessons`);
    const v = await version(course.id);

    for (let round = 0; round < 3; round += 1) {
      const current = await version(course.id);
      const results = await Promise.all(
        ['A', 'B'].map((tag) =>
          a
            .post(url)
            .set('If-Match', `"${current}"`)
            .send({ type: 'TEXT', title: `Leçon ${round}${tag}`, content: TEXT }),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses, JSON.stringify(results.map((r) => r.body))).toEqual([201, 409]);
      const conflict = results.find((r) => r.status === 409)!;
      expect(conflict.body).toMatchObject({
        code: 'VERSION_CONFLICT',
        details: { currentVersion: current + 1 },
      });
      expect(results.find((r) => r.status === 201)!.headers.etag).toBe(`"${current + 1}"`);
    }
    expect(await version(course.id)).toBe(v + 3);
    expect(await db.lesson.count({ where: { moduleId: modules[0]!.id } })).toBe(3);
    expect(await db.auditLog.count({ where: { action: 'lesson.created' } })).toBe(3);
    await expectStructureInvariant(db, course.id);

    // Without If-Match, concurrent creations both succeed and still get distinct positions.
    const both = await Promise.all(
      ['C', 'D'].map((tag) =>
        a.post(url).send({ type: 'TEXT', title: `Leçon ${tag}`, content: TEXT }),
      ),
    );
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    expect(both.map((r) => r.body.position).sort()).toEqual([4, 5]);
    await expectStructureInvariant(db, course.id);
  });
});
