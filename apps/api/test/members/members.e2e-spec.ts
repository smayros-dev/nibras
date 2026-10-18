import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { withTenantTx, type PrismaClient } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MEMBERSHIP_REMOVED, type MembershipRemovedEvent } from '../../src/members/events';
import { MembershipService } from '../../src/members/membership.service';
import {
  MEMBER_REMOVAL_BLOCKERS,
  type MemberRemovalBlocker,
} from '../../src/members/removal-blockers';
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

const members = (wid: string, path = '') => `/api/v1/workspaces/${wid}/members${path}`;

describe('members: scoped listing, role changes, removal (AC-WS-02, Review Focus 1)', () => {
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

  it('AC-WS-02: teacher with 2 of 50 assigned students lists 2; admin lists 50', async () => {
    const owner = await createUser({ totpSecret: S });
    const t = await createUser();
    const students = await Promise.all(Array.from({ length: 50 }, () => createUser()));
    const { workspace } = await createOrganization({ owner, teachers: [t], students });
    const ownerAgent = await agent(owner);
    for (const st of students.slice(0, 2)) {
      await ownerAgent
        .post(`/api/v1/workspaces/${workspace.id}/assignments`)
        .send({ teacherUserId: t.id, studentUserId: st.id })
        .expect(201);
    }
    const mine = await (
      await agent(t)
    )
      .get(`${members(workspace.id)}?role=STUDENT&limit=100`)
      .expect(200);
    expect(mine.body.items).toHaveLength(2);
    expect(mine.body.items[0].email).toBeUndefined();
    expect(mine.body.items.map((m: { userId: string }) => m.userId).sort()).toEqual(
      students
        .slice(0, 2)
        .map((s) => s.id)
        .sort(),
    );
    const all = await ownerAgent.get(`${members(workspace.id)}?role=STUDENT&limit=100`).expect(200);
    expect(all.body.items).toHaveLength(50);
    expect(all.body.items[0]).toMatchObject({
      email: expect.stringContaining('@'),
      role: 'STUDENT',
      canTeach: false,
      status: 'ACTIVE',
      joinedAt: expect.any(String),
    });
    expect(all.body.nextCursor).toBeNull();
  });

  it('scope own: assigned or invited-by-caller students only, whatever the role filter; no email search', async () => {
    const owner = await createUser({ totpSecret: S });
    const t = await createUser();
    const other = await createUser();
    const assigned = await createUser({ firstName: 'Amina', lastName: 'Zed' });
    const invited = await createUser({ firstName: 'Bilal', lastName: 'Yus' });
    const stranger = await createUser({ firstName: 'Chams', lastName: 'Xan' });
    const { workspace } = await createOrganization({
      owner,
      teachers: [t, other],
      students: [assigned, stranger],
      members: [{ user: invited, role: 'STUDENT', invitedByUserId: t.id }],
    });
    await assign(workspace, t, assigned, owner);
    await assign(workspace, other, stranger, owner);
    const teacher = await agent(t);

    const list = await teacher.get(members(workspace.id)).expect(200);
    expect(list.body.items.map((m: { userId: string }) => m.userId)).toEqual([
      invited.id,
      assigned.id,
    ]);
    for (const item of list.body.items) expect(item).not.toHaveProperty('email');

    // A role filter never widens the scope.
    await teacher
      .get(`${members(workspace.id)}?role=TEACHER`)
      .expect(200)
      .expect(({ body }) => expect(body.items).toEqual([]));
    // Name search works, email search does not.
    await teacher
      .get(`${members(workspace.id)}?q=amin`)
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(1));
    await teacher
      .get(`${members(workspace.id)}?q=${encodeURIComponent(assigned.email)}`)
      .expect(200)
      .expect(({ body }) => expect(body.items).toEqual([]));

    // GET one: inside the scope 200 without email; outside 404.
    await teacher
      .get(members(workspace.id, `/${assigned.id}`))
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ userId: assigned.id, firstName: 'Amina', role: 'STUDENT' });
        expect(body).not.toHaveProperty('email');
      });
    await teacher.get(members(workspace.id, `/${stranger.id}`)).expect(404);
    await teacher.get(members(workspace.id, `/${other.id}`)).expect(404);
  });

  it('scope all: q matches names and email case-insensitively; status filter; REMOVED hidden by default', async () => {
    const owner = await createUser({ totpSecret: S, firstName: 'Olfa', lastName: 'Owner' });
    const a = await createUser({
      firstName: 'Amina',
      lastName: 'Ben Ali',
      email: 'amina@school.tn',
    });
    const gone = await createUser({ firstName: 'Gone', lastName: 'Away' });
    const pending = await createUser({ firstName: 'Pen', lastName: 'Ding' });
    const { workspace } = await createOrganization({
      owner,
      students: [a],
      members: [
        { user: gone, role: 'STUDENT', status: 'REMOVED' },
        { user: pending, role: 'STUDENT', status: 'PENDING_GUARDIAN_CONSENT' },
      ],
    });
    const admin = await agent(owner);
    const ids = async (query: string) =>
      (await admin.get(`${members(workspace.id)}${query}`).expect(200)).body.items.map(
        (m: { userId: string }) => m.userId,
      );
    expect(await ids('')).toEqual([a.id, pending.id, owner.id]);
    expect(await ids('?q=BEN%20A')).toEqual([a.id]);
    expect(await ids('?q=SCHOOL.TN')).toEqual([a.id]);
    expect(await ids('?status=REMOVED')).toEqual([gone.id]);
    expect(await ids('?status=PENDING_GUARDIAN_CONSENT')).toEqual([pending.id]);
    expect(await ids('?role=OWNER')).toEqual([owner.id]);
    // A removed member's record stays readable by the staff.
    await admin
      .get(members(workspace.id, `/${gone.id}`))
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'REMOVED', email: gone.email }));
    await admin
      .get(`${members(workspace.id)}?limit=0`)
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('VALIDATION_FAILED'));
  });

  it('cursor pagination: last name, first name, user id; every member exactly once', async () => {
    const owner = await createUser({ totpSecret: S, lastName: 'Aaa' });
    const names = ['Ben', 'Ben', 'Ben', 'Chaker', 'Dali', 'Dali', 'Ezz'];
    const students = [];
    for (const [i, lastName] of names.entries()) {
      students.push(await createUser({ lastName, firstName: i % 2 === 0 ? 'Sami' : 'Ali' }));
    }
    const { workspace } = await createOrganization({ owner, students });
    const admin = await agent(owner);
    const seen: { userId: string; lastName: string; firstName: string }[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const res = await admin.get(`${members(workspace.id)}?limit=3${q}`).expect(200);
      seen.push(...res.body.items);
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(8);
    expect(new Set(seen.map((m) => m.userId)).size).toBe(8);
    const sorted = [...seen].sort(
      (x, y) =>
        x.lastName.localeCompare(y.lastName) ||
        x.firstName.localeCompare(y.firstName) ||
        (x.userId < y.userId ? -1 : 1),
    );
    expect(seen.map((m) => m.userId)).toEqual(sorted.map((m) => m.userId));
    await admin
      .get(`${members(workspace.id)}?cursor=not-a-cursor`)
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('VALIDATION_FAILED'));
  });

  it('a STUDENT may not list members (403 PERMISSION_DENIED); a personal OWNER lists all with emails', async () => {
    const owner = await createUser({ totpSecret: S });
    const st = await createUser();
    const { workspace } = await createOrganization({ owner, students: [st] });
    await (
      await agent(st)
    )
      .get(members(workspace.id))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('PERMISSION_DENIED'));

    const teacher = await createUser();
    const personal = await createPersonalWorkspace(teacher);
    const pupil = await createUser();
    await ctx.app.get(MembershipService).addMember({
      workspaceId: personal.id,
      userId: pupil.id,
      role: 'STUDENT',
      status: 'ACTIVE',
      invitedByUserId: teacher.id,
    });
    const list = await (await agent(teacher)).get(members(personal.id)).expect(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items.every((m: { email?: string }) => typeof m.email === 'string')).toBe(
      true,
    );
  });

  it('Review Focus 1: GET members/{uid} for a user who is only a member of another workspace is 404', async () => {
    const ownerA = await createUser({ totpSecret: S });
    const ownerB = await createUser({ totpSecret: S });
    const onlyB = await createUser();
    const both = await createUser();
    const { workspace: a } = await createOrganization({ owner: ownerA, students: [both] });
    const { workspace: b } = await createOrganization({
      owner: ownerB,
      students: [onlyB],
      teachers: [both],
    });
    const admin = await agent(ownerA);
    for (const res of [
      await admin.get(members(a.id, `/${onlyB.id}`)),
      await admin.patch(members(a.id, `/${onlyB.id}`)).send({ role: 'ADMIN' }),
      await admin.delete(members(a.id, `/${onlyB.id}`)),
      await admin.get(members(a.id, `/${ownerB.id}`)),
      await admin.get(members(a.id, `/${randomUUID()}`)),
      await admin.get(members(a.id, '/not-a-uuid')),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
    // A user in both: A's record, never B's.
    await admin
      .get(members(a.id, `/${both.id}`))
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ userId: both.id, role: 'STUDENT' }));
    // The list never shows B's members.
    const list = await admin.get(members(a.id)).expect(200);
    expect(list.body.items.map((m: { userId: string }) => m.userId).sort()).toEqual(
      [ownerA.id, both.id].sort(),
    );
    // And B's membership of `onlyB` is untouched.
    expect(
      (await db.membership.findFirstOrThrow({ where: { workspaceId: b.id, userId: onlyB.id } }))
        .status,
    ).toBe('ACTIVE');
  });

  it('student removal: org TEACHER → 403, org ADMIN → 204 with REMOVED + audit + event; personal OWNER → 204', async () => {
    const owner = await createUser({ totpSecret: S });
    const adminUser = await createUser({ totpSecret: S });
    const t = await createUser();
    const st = await createUser();
    const { workspace } = await createOrganization({
      owner,
      admins: [adminUser],
      teachers: [t],
      students: [st],
    });
    await assign(workspace, t, st, owner);
    await (
      await agent(t)
    )
      .delete(members(workspace.id, `/${st.id}`))
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('PERMISSION_DENIED'));

    const events: MembershipRemovedEvent[] = [];
    const listener = (e: MembershipRemovedEvent) => events.push(e);
    const emitter = ctx.app.get(EventEmitter2);
    emitter.on(MEMBERSHIP_REMOVED, listener);
    try {
      await (
        await agent(adminUser)
      )
        .delete(members(workspace.id, `/${st.id}`))
        .send({ reason: 'Fin de l’année' })
        .expect(204);
    } finally {
      emitter.off(MEMBERSHIP_REMOVED, listener);
    }
    const m = await db.membership.findFirstOrThrow({
      where: { workspaceId: workspace.id, userId: st.id },
    });
    expect(m).toMatchObject({ status: 'REMOVED', removalReason: 'Fin de l’année' });
    expect(m.removedAt).toBeInstanceOf(Date);
    expect(events).toEqual([
      expect.objectContaining({ workspaceId: workspace.id, userId: st.id, role: 'STUDENT' }),
    ]);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'member.removed', workspaceId: workspace.id },
    });
    expect(audit).toMatchObject({
      actorUserId: adminUser.id,
      actorRole: 'ADMIN',
      entityType: 'Membership',
      entityId: m.id,
      before: { status: 'ACTIVE', role: 'STUDENT' },
      after: { status: 'REMOVED', removalReason: 'Fin de l’année' },
    });
    // The student no longer sees the workspace; a second removal is 404.
    await (await agent(st)).get(`/api/v1/workspaces/${workspace.id}`).expect(404);
    await (await agent(adminUser)).delete(members(workspace.id, `/${st.id}`)).expect(404);
    // Nothing at user level was touched.
    expect((await db.user.findUniqueOrThrow({ where: { id: st.id } })).status).toBe('ACTIVE');

    // Personal workspace: the OWNER removes his student.
    const teacher = await createUser();
    const personal = await createPersonalWorkspace(teacher);
    const pupil = await createUser();
    await ctx.app.get(MembershipService).addMember({
      workspaceId: personal.id,
      userId: pupil.id,
      role: 'STUDENT',
      status: 'ACTIVE',
    });
    await (await agent(teacher)).delete(members(personal.id, `/${pupil.id}`)).expect(204);
    expect(
      (
        await db.membership.findFirstOrThrow({
          where: { workspaceId: personal.id, userId: pupil.id },
        })
      ).status,
    ).toBe('REMOVED');
  });

  it('staff removal needs workspace.staff.manage; a suspended workspace refuses it with 423', async () => {
    const owner = await createUser({ totpSecret: S });
    const t = await createUser();
    const t2 = await createUser();
    const { workspace } = await createOrganization({ owner, teachers: [t, t2] });
    await (await agent(t)).delete(members(workspace.id, `/${t2.id}`)).expect(403);
    await (await agent(owner)).delete(members(workspace.id, `/${t2.id}`)).expect(204);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'member.removed' } });
    expect(audit.before).toMatchObject({ role: 'TEACHER' });

    const { workspace: suspended } = await createOrganization({
      owner,
      teachers: [t2],
      status: 'SUSPENDED',
      suspendedReason: 'x',
    });
    await (
      await agent(owner)
    )
      .delete(members(suspended.id, `/${t2.id}`))
      .expect(423)
      .expect(({ body }) => expect(body.code).toBe('WORKSPACE_SUSPENDED'));
    await (await agent(owner)).get(members(suspended.id)).expect(200);
  });

  it('owner cannot be removed (409); role change STUDENT→ADMIN is 422; TEACHER→ADMIN audited and then 2FA is required for that user', async () => {
    const owner = await createUser({ totpSecret: S });
    const adminUser = await createUser({ totpSecret: S });
    const t = await createUser();
    const st = await createUser();
    const { workspace } = await createOrganization({
      owner,
      admins: [adminUser],
      teachers: [t],
      students: [st],
    });
    const admin = await agent(adminUser);
    await admin
      .delete(members(workspace.id, `/${owner.id}`))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('OWNER_CANNOT_BE_REMOVED'));
    for (const [uid, body] of [
      [st.id, { role: 'ADMIN' }],
      [owner.id, { role: 'ADMIN' }],
      [t.id, { role: 'OWNER' }],
      [t.id, { role: 'STUDENT' }],
    ] as const) {
      await admin
        .patch(members(workspace.id, `/${uid}`))
        .send(body)
        .expect(422)
        .expect(({ body: b }) => expect(b.code).toBe('ROLE_CHANGE_NOT_ALLOWED'));
    }
    // A teacher may not change roles.
    const teacher = await agent(t);
    await teacher
      .patch(members(workspace.id, `/${t.id}`))
      .send({ role: 'ADMIN' })
      .expect(403);

    await admin
      .patch(members(workspace.id, `/${t.id}`))
      .send({ role: 'ADMIN', canTeach: true })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ userId: t.id, role: 'ADMIN', canTeach: true }),
      );
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'member.role_changed', workspaceId: workspace.id },
    });
    expect(audit).toMatchObject({
      actorUserId: adminUser.id,
      entityType: 'Membership',
      before: { role: 'TEACHER', canTeach: false },
      after: { role: 'ADMIN', canTeach: true },
    });
    // D-P12: the promoted user (no TOTP) must now set up 2FA on his next request.
    await teacher
      .get(`/api/v1/workspaces/${workspace.id}`)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('TWO_FACTOR_SETUP_REQUIRED'));

    // ADMIN → TEACHER drops canTeach; canTeach alone on a TEACHER is refused.
    await admin
      .patch(members(workspace.id, `/${t.id}`))
      .send({ role: 'TEACHER' })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ role: 'TEACHER', canTeach: false }));
    await admin
      .patch(members(workspace.id, `/${t.id}`))
      .send({ canTeach: true })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('VALIDATION_FAILED'));
    await teacher.get(`/api/v1/workspaces/${workspace.id}`).expect(200);
    // An unchanged PATCH writes no audit row.
    await admin
      .patch(members(workspace.id, `/${t.id}`))
      .send({ role: 'TEACHER' })
      .expect(200);
    expect(await db.auditLog.count({ where: { action: 'member.role_changed' } })).toBe(2);
  });

  it('addMember on a REMOVED membership reactivates the same row; personal workspace auto-creates the assignment', async () => {
    const service = ctx.app.get(MembershipService);
    const owner = await createUser({ totpSecret: S });
    const st = await createUser();
    const { workspace, memberships } = await createOrganization({
      owner,
      members: [{ user: st, role: 'STUDENT', status: 'REMOVED' }],
    });
    const removed = memberships[1]!;
    await db.membership.update({
      where: { id: removed.id },
      data: { removalReason: 'left' },
    });
    const back = await service.addMember({
      workspaceId: workspace.id,
      userId: st.id,
      role: 'STUDENT',
      status: 'ACTIVE',
      invitedByUserId: owner.id,
    });
    expect(back.id).toBe(removed.id);
    expect(back).toMatchObject({
      status: 'ACTIVE',
      removedAt: null,
      removalReason: null,
      invitedByUserId: owner.id,
    });
    expect(back.joinedAt).toBeInstanceOf(Date);
    expect(await db.membership.count({ where: { workspaceId: workspace.id, userId: st.id } })).toBe(
      1,
    );
    // An organisation never auto-assigns.
    expect(await db.teacherStudentAssignment.count({ where: { workspaceId: workspace.id } })).toBe(
      0,
    );
    const added = await db.auditLog.findFirstOrThrow({
      where: { action: 'member.added', workspaceId: workspace.id },
    });
    expect(added).toMatchObject({ entityType: 'Membership', entityId: removed.id });
    expect(added.after).toMatchObject({ role: 'STUDENT', status: 'ACTIVE', reactivated: true });

    // A live membership → 409 ALREADY_MEMBER.
    await expect(
      service.addMember({
        workspaceId: workspace.id,
        userId: st.id,
        role: 'STUDENT',
        status: 'ACTIVE',
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_MEMBER', status: 409 });

    // Personal workspace: STUDENT → assignment(owner → student), inside the caller's transaction.
    const teacher = await createUser();
    const personal = await createPersonalWorkspace(teacher);
    const pupil = await createUser();
    const inTx = await withTenantTx(personal.id, (tx) =>
      service.addMember(
        { workspaceId: personal.id, userId: pupil.id, role: 'STUDENT', status: 'ACTIVE' },
        tx,
      ),
    );
    expect(inTx.membership).toMatchObject({ userId: pupil.id, status: 'ACTIVE' });
    // With a caller's tx the audit row waits for the caller, who logs it after the commit.
    const personalAdded = { action: 'member.added', workspaceId: personal.id };
    expect(await db.auditLog.count({ where: personalAdded })).toBe(0);
    await inTx.audit();
    expect(await db.auditLog.findFirstOrThrow({ where: personalAdded })).toMatchObject({
      entityId: inTx.membership.id,
      after: expect.objectContaining({ reactivated: false }),
    });
    const assignments = await db.teacherStudentAssignment.findMany({
      where: { workspaceId: personal.id },
    });
    expect(assignments).toEqual([
      expect.objectContaining({
        teacherUserId: teacher.id,
        studentUserId: pupil.id,
        assignedByUserId: teacher.id,
      }),
    ]);
    // Removed then re-added: still exactly one assignment.
    await (await agent(teacher)).delete(members(personal.id, `/${pupil.id}`)).expect(204);
    await service.addMember({
      workspaceId: personal.id,
      userId: pupil.id,
      role: 'STUDENT',
      status: 'ACTIVE',
    });
    expect(await db.teacherStudentAssignment.count({ where: { workspaceId: personal.id } })).toBe(
      1,
    );
  });

  it('concurrent reactivation of one REMOVED membership: one success, one 409 ALREADY_MEMBER, one audit row', async () => {
    const service = ctx.app.get(MembershipService);
    const owner = await createUser({ totpSecret: S });
    const st = await createUser();
    const { workspace, memberships } = await createOrganization({
      owner,
      members: [{ user: st, role: 'STUDENT', status: 'REMOVED' }],
    });
    const results = await Promise.allSettled(
      (['STUDENT', 'GUARDIAN'] as const).map((role) =>
        service.addMember({ workspaceId: workspace.id, userId: st.id, role, status: 'ACTIVE' }),
      ),
    );
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'ALREADY_MEMBER',
      status: 409,
    });
    const winner = (won[0] as PromiseFulfilledResult<{ id: string; role: string }>).value;
    expect(winner.id).toBe(memberships[1]!.id);
    // The row holds the winner's write, never a silent overwrite by the loser.
    const row = await db.membership.findUniqueOrThrow({ where: { id: winner.id } });
    expect(row).toMatchObject({ status: 'ACTIVE', role: winner.role });
    expect(
      await db.auditLog.count({ where: { action: 'member.added', workspaceId: workspace.id } }),
    ).toBe(1);
  });

  it('addMember in a caller tx that rolls back leaves no membership and no member.added audit row', async () => {
    const service = ctx.app.get(MembershipService);
    const teacher = await createUser();
    const personal = await createPersonalWorkspace(teacher);
    const pupil = await createUser();
    await expect(
      withTenantTx(personal.id, async (tx) => {
        await service.addMember(
          { workspaceId: personal.id, userId: pupil.id, role: 'STUDENT', status: 'ACTIVE' },
          tx,
        );
        throw new Error('caller rolls back');
      }),
    ).rejects.toThrow('caller rolls back');
    expect(
      await db.membership.count({ where: { workspaceId: personal.id, userId: pupil.id } }),
    ).toBe(0);
    expect(await db.teacherStudentAssignment.count({ where: { workspaceId: personal.id } })).toBe(
      0,
    );
    expect(await db.auditLog.count({ where: { action: 'member.added' } })).toBe(0);
  });
});

describe('members: removal blockers (AC-WS-05)', () => {
  let ctx: TestContext;
  let http: TestAgent;
  let db: PrismaClient;
  const calls: [string, string][] = [];
  let answer: Awaited<ReturnType<MemberRemovalBlocker['check']>> = null;
  const stub: MemberRemovalBlocker = {
    check: (workspaceId, userId) => {
      calls.push([workspaceId, userId]);
      return Promise.resolve(answer);
    },
  };

  beforeAll(async () => {
    ctx = await createTestApp({
      overrides: (b) => b.overrideProvider(MEMBER_REMOVAL_BLOCKERS).useValue([stub]),
    });
    ({ http, db } = ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    calls.length = 0;
    answer = null;
  });

  it('AC-WS-05: removal blocked by a registered blocker with the list of sessions', async () => {
    const owner = await createUser({ totpSecret: S });
    const adminUser = await createUser({ totpSecret: S });
    const teacher = await createUser();
    const { workspace } = await createOrganization({
      owner,
      admins: [adminUser],
      teachers: [teacher],
    });
    const wid = workspace.id;
    const adminAgent = as(http, (await loginAs(ctx, adminUser)).cookie);
    answer = {
      code: 'MEMBER_HAS_FUTURE_SESSIONS',
      items: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
    };
    const res = await adminAgent
      .delete(`/api/v1/workspaces/${wid}/members/${teacher.id}`)
      .expect(409);
    expect(res.body.code).toBe('MEMBER_HAS_FUTURE_SESSIONS');
    expect(res.body.details.items).toHaveLength(3);
    expect(calls).toEqual([[wid, teacher.id]]);
    expect(
      (await db.membership.findFirst({ where: { workspaceId: wid, userId: teacher.id } }))!.status,
    ).toBe('ACTIVE');
    expect(await db.auditLog.count({ where: { action: 'member.removed' } })).toBe(0);

    // Once the blocker clears, the removal goes through.
    answer = null;
    await adminAgent.delete(`/api/v1/workspaces/${wid}/members/${teacher.id}`).expect(204);
    expect(
      (await db.membership.findFirst({ where: { workspaceId: wid, userId: teacher.id } }))!.status,
    ).toBe('REMOVED');
  });
});
