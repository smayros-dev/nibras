import type { PrismaClient, User } from '@nibras/db';
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

describe('structure: modules (SP3 T6)', () => {
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

  it('create appends, unlock rule AFTER_DATE → 422, every write audited and bumps the course version', async () => {
    const teacher = await createUser();
    const workspace = await createPersonalWorkspace(teacher);
    const course = await createCourse(workspace, teacher);
    const a = await agent(teacher);
    const url = ws(workspace.id, `/courses/${course.id}/modules`);

    const m1 = await a
      .post(url)
      .send({ title: '  Introduction  ' })
      .expect(201)
      .expect('ETag', '"2"');
    expect(m1.body).toMatchObject({
      title: 'Introduction',
      description: null,
      position: 1,
      isOptional: false,
      unlockRule: { type: 'NONE' },
      version: 1,
      lessons: [],
    });
    const m2 = await a
      .post(url)
      .set('If-Match', '"2"')
      .send({
        title: 'Chapitre 2',
        description: 'Suite',
        isOptional: true,
        unlockRule: { type: 'PREVIOUS_MODULE_COMPLETED' },
      })
      .expect(201)
      .expect('ETag', '"3"');
    expect(m2.body).toMatchObject({
      position: 2,
      isOptional: true,
      unlockRule: { type: 'PREVIOUS_MODULE_COMPLETED' },
    });
    // A stale If-Match on create is a conflict; P1 unlock rules are refused.
    await a
      .post(url)
      .set('If-Match', '"2"')
      .send({ title: 'X' })
      .expect(409)
      .expect(({ body }) => expect(body.details).toEqual({ currentVersion: 3 }));
    await a
      .post(url)
      .send({ title: 'X', unlockRule: { type: 'AFTER_DATE', date: '2027-01-01' } })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('VALIDATION_FAILED'));
    expect(await version(course.id)).toBe(3);
    const created = await db.auditLog.findMany({
      where: { action: 'module.created' },
      orderBy: { createdAt: 'asc' },
    });
    expect(created.map((r) => r.entityId)).toEqual([m1.body.id, m2.body.id]);
    expect(created[0]).toMatchObject({ entityType: 'Module', workspaceId: workspace.id });
    expect(created[0]!.after).toMatchObject({
      courseId: course.id,
      title: 'Introduction',
      position: 1,
    });

    // PATCH needs If-Match, bumps the course and module versions.
    const mod = ws(workspace.id, `/modules/${m1.body.id}`);
    await a.patch(mod).send({ title: 'Intro' }).expect(428);
    await a
      .patch(mod)
      .set('If-Match', '"1"')
      .send({ title: 'Intro' })
      .expect(409)
      .expect(({ body }) => expect(body.details).toEqual({ currentVersion: 3 }));
    await a
      .patch(mod)
      .set('If-Match', '"3"')
      .send({ unlockRule: { type: 'AFTER_DATE' } })
      .expect(422);
    const patched = await a
      .patch(mod)
      .set('If-Match', '"3"')
      .send({ title: 'Intro', isOptional: true })
      .expect(200)
      .expect('ETag', '"4"');
    expect(patched.body).toMatchObject({ title: 'Intro', isOptional: true, version: 2 });
    const upd = await db.auditLog.findFirstOrThrow({ where: { action: 'module.updated' } });
    expect(upd.before).toEqual({ title: 'Introduction', isOptional: false });
    expect(upd.after).toEqual({ title: 'Intro', isOptional: true });
    await expectStructureInvariant(db, course.id);
  });

  it('delete renumbers and cascades lessons (their media stay); structure lists media statuses', async () => {
    const teacher = await createUser();
    const workspace = await createPersonalWorkspace(teacher);
    const course = await createCourse(workspace, teacher);
    const [m1, m2, m3] = [
      await createModule(course),
      await createModule(course),
      await createModule(course),
    ];
    const video = await createMediaAsset(workspace, teacher, {
      kind: 'VIDEO',
      status: 'PROCESSING',
    });
    const pdf = await createMediaAsset(workspace, teacher, { kind: 'PDF' });
    await createLesson(m2!, { type: 'VIDEO', mediaAsset: video });
    await createLesson(m2!, { type: 'TEXT' });
    await createLesson(m3!, { type: 'PDF', mediaAsset: pdf });
    const a = await agent(teacher);

    const structure = await a
      .get(ws(workspace.id, `/courses/${course.id}/structure`))
      .expect(200)
      .expect('ETag', '"1"');
    expect(structure.body.modules.map((m: { id: string }) => m.id)).toEqual([
      m1!.id,
      m2!.id,
      m3!.id,
    ]);
    expect(structure.body.modules[1].lessons).toMatchObject([
      { type: 'VIDEO', position: 1, media: { id: video.id, status: 'PROCESSING' } },
      { type: 'TEXT', position: 2, media: null, hasContent: true },
    ]);
    expect(structure.body.modules[2].lessons[0].media).toMatchObject({
      id: pdf.id,
      kind: 'PDF',
      status: 'READY',
    });

    await a
      .delete(ws(workspace.id, `/modules/${m2!.id}`))
      .expect(204)
      .expect('ETag', '"2"');
    const rows = await db.module.findMany({
      where: { courseId: course.id },
      orderBy: { position: 'asc' },
    });
    expect(rows.map((r) => [r.id, r.position])).toEqual([
      [m1!.id, 1],
      [m3!.id, 2],
    ]);
    expect(await db.lesson.count({ where: { moduleId: m2!.id } })).toBe(0);
    expect(await db.mediaAsset.count({ where: { id: video.id, deletedAt: null } })).toBe(1);
    const del = await db.auditLog.findFirstOrThrow({ where: { action: 'module.deleted' } });
    expect(del).toMatchObject({ entityType: 'Module', entityId: m2!.id });
    expect(del.before).toMatchObject({ courseId: course.id, position: 2, lessonCount: 2 });
    expect(await version(course.id)).toBe(2);
    await a.delete(ws(workspace.id, `/modules/${m2!.id}`)).expect(404);
    await expectStructureInvariant(db, course.id);
  });

  it('a STUDENT gets 403; another workspace’s module is 404', async () => {
    const S = 'JBSWY3DPEHPK3PXP';
    const owner = await createUser({ totpSecret: S });
    const student = await createUser();
    const teacher = await createUser();
    const { workspace } = await createOrganization({
      owner,
      teachers: [teacher],
      students: [student],
    });
    const course = await createCourse(workspace, teacher);
    const module = await createModule(course);
    const s = await agent(student);
    await s
      .get(ws(workspace.id, `/courses/${course.id}/structure`))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('PERMISSION_DENIED'));
    await s
      .patch(ws(workspace.id, `/modules/${module.id}`))
      .set('If-Match', '"1"')
      .send({ title: 'X' })
      .expect(403);

    const other = await createUser();
    const otherWs = await createPersonalWorkspace(other);
    const o = await agent(other);
    await o
      .patch(ws(otherWs.id, `/modules/${module.id}`))
      .set('If-Match', '"1"')
      .send({ title: 'X' })
      .expect(404);
    await o
      .post(ws(otherWs.id, `/modules/${module.id}/lessons`))
      .send({ type: 'TEXT', title: 'X', content: { type: 'doc', content: [] } })
      .expect(404);
    expect((await db.module.findUniqueOrThrow({ where: { id: module.id } })).title).toBe(
      module.title,
    );
  });
});
