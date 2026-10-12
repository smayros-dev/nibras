import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@tt/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import {
  assign,
  createOrganization,
  createPersonalWorkspace,
  createUser,
} from '../helpers/factories';

/** Base32 TOTP seed: organisation OWNER/ADMIN clear the 2FA gate with it. */
const S = 'JBSWY3DPEHPK3PXP';

const assignments = (wid: string, path = '') => `/api/v1/workspaces/${wid}/assignments${path}`;

describe('teacher ↔ student assignments', () => {
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

  const agent = async (user: Parameters<typeof loginAs>[1]) =>
    as(http, (await loginAs(ctx, user)).cookie);

  it('POST: 201 with audit; the same pair again is 409 ALREADY_ASSIGNED', async () => {
    const owner = await createUser({ totpSecret: S });
    const t = await createUser();
    const st = await createUser();
    const { workspace } = await createOrganization({ owner, teachers: [t], students: [st] });
    const admin = await agent(owner);
    const res = await admin
      .post(assignments(workspace.id))
      .send({ teacherUserId: t.id, studentUserId: st.id })
      .expect(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      teacherUserId: t.id,
      studentUserId: st.id,
      assignedByUserId: owner.id,
      createdAt: expect.any(String),
    });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'assignment.created', workspaceId: workspace.id },
    });
    expect(audit).toMatchObject({
      actorUserId: owner.id,
      actorRole: 'OWNER',
      entityType: 'TeacherStudentAssignment',
      entityId: res.body.id,
      after: { teacherUserId: t.id, studentUserId: st.id },
    });
    await admin
      .post(assignments(workspace.id))
      .send({ teacherUserId: t.id, studentUserId: st.id })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('ALREADY_ASSIGNED'));
    expect(await db.teacherStudentAssignment.count()).toBe(1);
  });

  it('POST: 422 unless an ACTIVE TEACHER (or ADMIN with canTeach) and an ACTIVE STUDENT of this workspace', async () => {
    const owner = await createUser({ totpSecret: S });
    const t = await createUser();
    const st = await createUser();
    const adminNoTeach = await createUser({ totpSecret: S });
    const adminTeach = await createUser({ totpSecret: S });
    const pendingSt = await createUser();
    const removedT = await createUser();
    const outsider = await createUser();
    const { workspace } = await createOrganization({
      owner,
      teachers: [t],
      students: [st],
      members: [
        { user: adminNoTeach, role: 'ADMIN' },
        { user: adminTeach, role: 'ADMIN', canTeach: true },
        { user: pendingSt, role: 'STUDENT', status: 'PENDING_GUARDIAN_CONSENT' },
        { user: removedT, role: 'TEACHER', status: 'REMOVED' },
      ],
    });
    // The outsider teaches elsewhere.
    await createOrganization({ owner: await createUser({ totpSecret: S }), teachers: [outsider] });
    const admin = await agent(owner);
    for (const [teacherUserId, studentUserId, path] of [
      [st.id, t.id, 'teacherUserId'],
      [adminNoTeach.id, st.id, 'teacherUserId'],
      [removedT.id, st.id, 'teacherUserId'],
      [outsider.id, st.id, 'teacherUserId'],
      [randomUUID(), st.id, 'teacherUserId'],
      [t.id, pendingSt.id, 'studentUserId'],
      [t.id, t.id, 'studentUserId'],
      [t.id, outsider.id, 'studentUserId'],
    ] as const) {
      const res = await admin
        .post(assignments(workspace.id))
        .send({ teacherUserId, studentUserId })
        .expect(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details.issues[0].path).toEqual([path]);
    }
    await admin
      .post(assignments(workspace.id))
      .send({ teacherUserId: 'x', studentUserId: st.id })
      .expect(422);
    await admin
      .post(assignments(workspace.id))
      .send({ teacherUserId: adminTeach.id, studentUserId: st.id })
      .expect(201);
    expect(await db.teacherStudentAssignment.count()).toBe(1);
  });

  it('POST/DELETE need student.assign: org TEACHER and personal OWNER get 403', async () => {
    const owner = await createUser({ totpSecret: S });
    const t = await createUser();
    const st = await createUser();
    const { workspace } = await createOrganization({ owner, teachers: [t], students: [st] });
    const a = await assign(workspace, t, st, owner);
    const teacher = await agent(t);
    await teacher
      .post(assignments(workspace.id))
      .send({ teacherUserId: t.id, studentUserId: st.id })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('PERMISSION_DENIED'));
    await teacher.delete(assignments(workspace.id, `/${a.id}`)).expect(403);

    const solo = await createUser();
    const personal = await createPersonalWorkspace(solo);
    await (
      await agent(solo)
    )
      .post(assignments(personal.id))
      .send({ teacherUserId: solo.id, studentUserId: st.id })
      .expect(403);
  });

  it('GET: staff see all (filters apply); a TEACHER only his own; a STUDENT gets 403', async () => {
    const owner = await createUser({ totpSecret: S });
    const t1 = await createUser();
    const t2 = await createUser();
    const s1 = await createUser();
    const s2 = await createUser();
    const st = await createUser();
    const { workspace } = await createOrganization({
      owner,
      teachers: [t1, t2],
      students: [s1, s2, st],
    });
    const a1 = await assign(workspace, t1, s1, owner);
    const a2 = await assign(workspace, t1, s2, owner);
    const a3 = await assign(workspace, t2, s1, owner);
    const admin = await agent(owner);
    const ids = async (who: Awaited<ReturnType<typeof agent>>, query = '') =>
      (await who.get(`${assignments(workspace.id)}${query}`).expect(200)).body.items.map(
        (x: { id: string }) => x.id,
      );
    expect(await ids(admin)).toEqual([a1.id, a2.id, a3.id]);
    expect(await ids(admin, `?teacherUserId=${t1.id}`)).toEqual([a1.id, a2.id]);
    expect(await ids(admin, `?studentUserId=${s1.id}`)).toEqual([a1.id, a3.id]);
    const page = await admin.get(`${assignments(workspace.id)}?limit=2`).expect(200);
    expect(page.body.items).toHaveLength(2);
    expect(page.body.nextCursor).toBe(a2.id);
    expect(await ids(admin, `?limit=2&cursor=${a2.id}`)).toEqual([a3.id]);

    const teacher = await agent(t2);
    expect(await ids(teacher)).toEqual([a3.id]);
    expect(await ids(teacher, `?teacherUserId=${t1.id}`)).toEqual([]);
    await (await agent(st)).get(assignments(workspace.id)).expect(403);
  });

  it('DELETE: 204 with audit; unknown, malformed or another workspace’s id is 404', async () => {
    const owner = await createUser({ totpSecret: S });
    const t = await createUser();
    const st = await createUser();
    const { workspace } = await createOrganization({ owner, teachers: [t], students: [st] });
    const ownerB = await createUser({ totpSecret: S });
    const { workspace: b } = await createOrganization({
      owner: ownerB,
      teachers: [t],
      students: [st],
    });
    const a = await assign(workspace, t, st, owner);
    const inB = await assign(b, t, st, ownerB);
    const admin = await agent(owner);

    for (const id of [inB.id, randomUUID(), 'nope']) {
      await admin
        .delete(assignments(workspace.id, `/${id}`))
        .expect(404)
        .expect(({ body }) => expect(body.code).toBe('NOT_FOUND'));
    }
    expect(await db.teacherStudentAssignment.count({ where: { id: inB.id } })).toBe(1);
    // A's listing never shows B's assignment.
    const list = await admin.get(assignments(workspace.id)).expect(200);
    expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([a.id]);

    await admin.delete(assignments(workspace.id, `/${a.id}`)).expect(204);
    expect(await db.teacherStudentAssignment.count({ where: { id: a.id } })).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'assignment.deleted', workspaceId: workspace.id },
    });
    expect(audit).toMatchObject({
      actorUserId: owner.id,
      entityType: 'TeacherStudentAssignment',
      entityId: a.id,
      before: { teacherUserId: t.id, studentUserId: st.id },
    });
  });
});
