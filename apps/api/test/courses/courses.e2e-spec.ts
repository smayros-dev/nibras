import type { PrismaClient, User, Workspace } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import {
  createCourse,
  createMediaAsset,
  createOrganization,
  createPersonalWorkspace,
  createUser,
} from '../helpers/factories';
import { expectStructureInvariant } from '../helpers/invariants';

const S = 'JBSWY3DPEHPK3PXP';
const MIB = 1024n * 1024n;

describe('courses: CRUD, If-Match, scopes, reassign (SP3 T5)', () => {
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
    const teacher = await createUser({ firstName: 'Mohamed', lastName: 'Ben Ali' });
    const workspace = await createPersonalWorkspace(teacher);
    return { teacher, workspace };
  }

  /** OWNER and ADMIN (no `canTeach`), two TEACHERs, a teaching ADMIN and a STUDENT. */
  async function organisation() {
    const owner = await createUser({ totpSecret: S, firstName: 'Owner' });
    const admin = await createUser({ totpSecret: S, firstName: 'Admin' });
    const teachingAdmin = await createUser({ totpSecret: S, firstName: 'Teaching' });
    const teacher = await createUser({ firstName: 'Teacher' });
    const teacher2 = await createUser({ firstName: 'Teacher2' });
    const student = await createUser({ firstName: 'Student' });
    const { workspace } = await createOrganization({
      owner,
      admins: [admin],
      teachers: [teacher, teacher2],
      students: [student],
      members: [{ user: teachingAdmin, role: 'ADMIN', canTeach: true }],
    });
    return { owner, admin, teachingAdmin, teacher, teacher2, student, workspace };
  }

  it('a teacher creates a DRAFT course with the workspace defaults; list/tabs; a student gets 403 on the workspace routes', async () => {
    const { teacher, workspace } = await personal();
    await db.workspace.update({
      where: { id: workspace.id },
      data: {
        settings: {
          ...(workspace.settings as Record<string, unknown>),
          default_sequential_lessons: true,
        },
      },
    });
    const a = await agent(teacher);

    const res = await a
      .post(courses(workspace.id))
      .send({ title: '  Algèbre  ', level: 'COLLEGE', category: 'Maths' })
      .expect(201);
    expect(res.body).toMatchObject({
      title: 'Algèbre',
      status: 'DRAFT',
      level: 'COLLEGE',
      category: 'Maths',
      language: 'fr',
      sequentialLessons: true,
      isCertifying: false,
      ownerUserId: teacher.id,
      owner: { firstName: 'Mohamed', lastName: 'Ben Ali' },
      version: 1,
      moduleCount: 0,
      lessonCount: 0,
      enrolledCount: 0,
      estimatedMinutes: null,
      estimatedMinutesOverride: null,
      coverMediaId: null,
      coverUrl: null,
      description: null,
      publishedAt: null,
      archivedAt: null,
      deletedAt: null,
      canPublish: false,
      publishBlockers: ['NO_MODULE'],
    });
    const cid = res.body.id as string;
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'course.created' } });
    expect(audit).toMatchObject({ entityType: 'Course', entityId: cid, workspaceId: workspace.id });
    expect(audit.after).toMatchObject({
      title: 'Algèbre',
      status: 'DRAFT',
      ownerUserId: teacher.id,
    });
    await expectStructureInvariant(db, cid);

    // `sequentialLessons` given explicitly wins over the default.
    await a
      .post(courses(workspace.id))
      .send({ title: 'Géométrie', sequentialLessons: false, language: 'ar' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.sequentialLessons).toBe(false);
        expect(body.language).toBe('ar');
      });
    await createCourse(workspace, teacher, { title: 'Physique', status: 'PUBLISHED' });

    await a
      .get(courses(workspace.id, `/${cid}`))
      .expect(200)
      .expect('ETag', '"1"')
      .expect(({ body }) => expect(body.id).toBe(cid));

    // Newest first, keyset pages, status and q filters.
    const all = await a.get(courses(workspace.id)).expect(200);
    expect(all.body.items.map((c: { title: string }) => c.title)).toEqual([
      'Physique',
      'Géométrie',
      'Algèbre',
    ]);
    expect(all.body.nextCursor).toBeNull();
    const page1 = await a.get(courses(workspace.id)).query({ limit: 2 }).expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBe(page1.body.items[1].id);
    const page2 = await a
      .get(courses(workspace.id))
      .query({ limit: 2, cursor: page1.body.nextCursor })
      .expect(200);
    expect(page2.body.items.map((c: { title: string }) => c.title)).toEqual(['Algèbre']);
    expect(page2.body.nextCursor).toBeNull();
    await a
      .get(courses(workspace.id))
      .query({ status: 'PUBLISHED' })
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.map((c: { title: string }) => c.title)).toEqual(['Physique']),
      );
    await a
      .get(courses(workspace.id))
      .query({ q: 'géo' })
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.map((c: { title: string }) => c.title)).toEqual(['Géométrie']),
      );
    // An unknown cursor (not a course of this workspace) → 422.
    await a
      .get(courses(workspace.id))
      .query({ cursor: '0199e7a0-0000-7000-8000-000000000000' })
      .expect(422)
      .expect(({ body }) => expect(body.details.issues[0].path).toEqual(['cursor']));
    await a.get(courses(workspace.id, '/not-a-uuid')).expect(404);

    // STUDENT (and GUARDIAN) memberships use /me/courses, never the workspace routes.
    const { student, workspace: org, teacher: orgTeacher } = await organisation();
    const orgCourse = await createCourse(org, orgTeacher);
    const s = await agent(student);
    for (const req of [
      s.get(courses(org.id)),
      s.post(courses(org.id)).send({ title: 'X' }),
      s.get(courses(org.id, `/${orgCourse.id}`)),
      s.post(courses(org.id, `/${orgCourse.id}/publish`)),
    ]) {
      await req.expect(403).expect(({ body }) => expect(body.code).toBe('PERMISSION_DENIED'));
    }
  });

  it('cover: a READY IMAGE of the workspace gets a short signed URL; anything else → 422', async () => {
    const { teacher, workspace } = await personal();
    const a = await agent(teacher);
    const image = await createMediaAsset(workspace, teacher, { kind: 'IMAGE' });
    const pdf = await createMediaAsset(workspace, teacher, { kind: 'PDF' });
    const uploading = await createMediaAsset(workspace, teacher, {
      kind: 'IMAGE',
      status: 'UPLOADING',
    });
    const other = await personal();
    const foreign = await createMediaAsset(other.workspace, other.teacher, { kind: 'IMAGE' });

    const res = await a
      .post(courses(workspace.id))
      .send({ title: 'Couverture', coverMediaId: image.id })
      .expect(201);
    expect(res.body.coverMediaId).toBe(image.id);
    expect(res.body.coverUrl).toMatch(/X-Amz-Signature=/);
    expect(res.body.coverUrl).toMatch(/X-Amz-Expires=300/);
    const list = await a.get(courses(workspace.id)).expect(200);
    expect(list.body.items[0].coverUrl).toMatch(/X-Amz-Signature=/);

    for (const id of [pdf.id, uploading.id, foreign.id, '0199e7a0-0000-7000-8000-000000000001']) {
      await a
        .post(courses(workspace.id))
        .send({ title: 'X', coverMediaId: id })
        .expect(422)
        .expect(({ body }) => {
          expect(body.code).toBe('VALIDATION_FAILED');
          expect(body.details.issues[0].path).toEqual(['coverMediaId']);
        });
      await a
        .patch(courses(workspace.id, `/${res.body.id}`))
        .set('If-Match', '"1"')
        .send({ coverMediaId: id })
        .expect(422);
    }
    expect(await db.course.count()).toBe(1);
    // `null` clears the cover.
    await a
      .patch(courses(workspace.id, `/${res.body.id}`))
      .set('If-Match', '"1"')
      .send({ coverMediaId: null })
      .expect(200)
      .expect(({ body }) => {
        expect(body.coverMediaId).toBeNull();
        expect(body.coverUrl).toBeNull();
      });
    // No presigned URL ever reaches the logs.
    expect(JSON.stringify(ctx.logs.lines())).not.toContain('X-Amz-Signature');
  });

  it('PATCH needs If-Match: 428 without, 409 VERSION_CONFLICT with the current version on a stale one, ETag follows (AC-CRS-03)', async () => {
    const { teacher, workspace } = await personal();
    const course = await createCourse(workspace, teacher, { title: 'A' });
    const a = await agent(teacher);
    const url = courses(workspace.id, `/${course.id}`);

    await a
      .patch(url)
      .send({ title: 'B' })
      .expect(428)
      .expect(({ body }) => expect(body.code).toBe('VERSION_REQUIRED'));
    await a.patch(url).set('If-Match', '*').send({ title: 'B' }).expect(428);
    await a
      .patch(url)
      .set('If-Match', '"1"')
      .send({ title: 'B' })
      .expect(200)
      .expect('ETag', '"2"');
    const res = await a.patch(url).set('If-Match', '"1"').send({ title: 'C' }).expect(409);
    expect(res.body).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 2 } });
    // « écraser »: the client retries with the version the conflict named.
    await a
      .patch(url)
      .set('If-Match', '"2"')
      .send({ title: 'C' })
      .expect(200)
      .expect('ETag', '"3"');
    await a.get(url).expect(200).expect('ETag', '"3"');

    const res2 = await a
      .patch(url)
      .set('If-Match', '3')
      .send({
        description: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] }],
        },
        estimatedMinutes: 90,
        level: 'LYCEE',
      })
      .expect(200);
    expect(res2.body).toMatchObject({
      title: 'C',
      version: 4,
      estimatedMinutes: 90,
      estimatedMinutesOverride: 90,
      level: 'LYCEE',
      description: { type: 'doc' },
    });
    // Validation: nothing to update, unknown key, rich text outside the whitelist.
    await a.patch(url).set('If-Match', '"4"').send({}).expect(422);
    await a.patch(url).set('If-Match', '"4"').send({ status: 'PUBLISHED' }).expect(422);
    await a
      .patch(url)
      .set('If-Match', '"4"')
      .send({ description: { type: 'doc', content: [{ type: 'script' }] } })
      .expect(422);

    const audits = await db.auditLog.findMany({
      where: { action: 'course.updated', entityId: course.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits).toHaveLength(3);
    expect(audits[0]!.before).toMatchObject({ title: 'A' });
    expect(audits[0]!.after).toMatchObject({ title: 'B' });
    expect(audits[2]!.after).toMatchObject({ estimatedMinutes: 90, level: 'LYCEE' });
    expect((await db.course.findUniqueOrThrow({ where: { id: course.id } })).version).toBe(4);

    // A deleted course, an unknown one: 404 before the version check.
    await a
      .patch(courses(workspace.id, '/0199e7a0-0000-7000-8000-000000000002'))
      .send({ title: 'X' })
      .expect(404);
  });

  it('scope own: an org TEACHER sees and edits only his courses; ADMIN sees all; reassign is ADMIN-only and ORGANIZATION-only', async () => {
    const o = await organisation();
    const t1 = await agent(o.teacher);
    const t2 = await agent(o.teacher2);
    const admin = await agent(o.admin);

    const c1 = (await t1.post(courses(o.workspace.id)).send({ title: 'Cours T1' }).expect(201)).body
      .id as string;
    const c2 = (await t2.post(courses(o.workspace.id)).send({ title: 'Cours T2' }).expect(201)).body
      .id as string;
    // An ADMIN without canTeach does not create (AC-WS-03); a teaching ADMIN does.
    await admin.post(courses(o.workspace.id)).send({ title: 'X' }).expect(403);
    await (
      await agent(o.teachingAdmin)
    )
      .post(courses(o.workspace.id))
      .send({ title: 'Cours admin' })
      .expect(201);

    const titles = (body: { items: { title: string }[] }) => body.items.map((c) => c.title);
    await t1
      .get(courses(o.workspace.id))
      .expect(200)
      .expect(({ body }) => expect(titles(body)).toEqual(['Cours T1']));
    await t1.get(courses(o.workspace.id, `/${c2}`)).expect(404);
    await t1
      .patch(courses(o.workspace.id, `/${c2}`))
      .set('If-Match', '"1"')
      .send({ title: 'Z' })
      .expect(404);
    await t1.post(courses(o.workspace.id, `/${c2}/archive`)).expect(404);
    await t1.delete(courses(o.workspace.id, `/${c2}`)).expect(404);
    // T2's course as a cursor of T1's listing: not in his scope → 422.
    await t1.get(courses(o.workspace.id)).query({ cursor: c2 }).expect(422);
    await admin
      .get(courses(o.workspace.id))
      .expect(200)
      .expect(({ body }) =>
        expect(titles(body).sort()).toEqual(['Cours T1', 'Cours T2', 'Cours admin']),
      );
    await admin
      .patch(courses(o.workspace.id, `/${c1}`))
      .set('If-Match', '"1"')
      .send({ title: 'Cours T1 (relu)' })
      .expect(200);

    // Reassign: course.reassign is ADMIN/OWNER only.
    await t1
      .post(courses(o.workspace.id, `/${c1}/reassign`))
      .send({ ownerUserId: o.teacher2.id })
      .expect(403);
    // The target must teach here: a STUDENT, a non-teaching ADMIN, a stranger → 422.
    const stranger = await createUser();
    for (const target of [o.student, o.admin, stranger]) {
      await admin
        .post(courses(o.workspace.id, `/${c1}/reassign`))
        .send({ ownerUserId: target.id })
        .expect(422)
        .expect(({ body }) => expect(body.details.issues[0].path).toEqual(['ownerUserId']));
    }
    const res = await admin
      .post(courses(o.workspace.id, `/${c1}/reassign`))
      .send({ ownerUserId: o.teacher2.id })
      .expect(200);
    expect(res.body).toMatchObject({ ownerUserId: o.teacher2.id, version: 3 });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'course.reassigned' } });
    expect(audit).toMatchObject({ entityType: 'Course', entityId: c1 });
    expect(audit.before).toEqual({ ownerUserId: o.teacher.id });
    expect(audit.after).toEqual({ ownerUserId: o.teacher2.id });
    await t1.get(courses(o.workspace.id, `/${c1}`)).expect(404);
    await t2.get(courses(o.workspace.id, `/${c1}`)).expect(200);
    // To a teaching ADMIN also works.
    await admin
      .post(courses(o.workspace.id, `/${c1}/reassign`))
      .send({ ownerUserId: o.teachingAdmin.id })
      .expect(200);

    // A PERSONAL workspace has no reassign (its OWNER holds no course.reassign).
    const { teacher, workspace } = await personal();
    const mine = await createCourse(workspace, teacher);
    await (
      await agent(teacher)
    )
      .post(courses(workspace.id, `/${mine.id}/reassign`))
      .send({ ownerUserId: teacher.id })
      .expect(403);
  });

  it('storage reports reservedBytes of UPLOADING assets', async () => {
    const { teacher, workspace } = await personal();
    await db.workspace.update({
      where: { id: workspace.id },
      data: { storageUsedBytes: 3n * MIB },
    });
    await createMediaAsset(workspace, teacher, {
      kind: 'VIDEO',
      status: 'UPLOADING',
      sizeBytes: 5n * MIB,
    });
    await createMediaAsset(workspace, teacher, {
      kind: 'PDF',
      status: 'UPLOADING',
      sizeBytes: 2n * MIB,
    });
    await createMediaAsset(workspace, teacher, {
      kind: 'PDF',
      status: 'READY',
      sizeBytes: 3n * MIB,
    });
    // Another workspace's upload is not reserved here.
    const other = await personal();
    await createMediaAsset(other.workspace, other.teacher, {
      kind: 'VIDEO',
      status: 'UPLOADING',
      sizeBytes: 100n * MIB,
    });

    await (
      await agent(teacher)
    )
      .get(`/api/v1/workspaces/${workspace.id}/storage`)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({
          quotaBytes: (20n * 1024n * MIB).toString(),
          usedBytes: (3n * MIB).toString(),
          reservedBytes: (7n * MIB).toString(),
        }),
      );
  });
});
