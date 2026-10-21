import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { COURSE_ASSIGNED_NOTIFY_JOB } from '@nibras/contracts';
import type { PrismaClient, User, Workspace } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INVITE_LINK_JOINED, type InviteLinkJoinedEvent } from '../../src/members/events';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import {
  adultBirthDate,
  createCourse,
  createEnrollment,
  createInvitation,
  createInviteLink,
  createOrganization,
  createPersonalWorkspace,
  createUser,
  minorBirthDate,
} from '../helpers/factories';

const S = 'JBSWY3DPEHPK3PXP';

/** A teacher who passes `@RequireVerifiedTeacher()`. */
const verifiedUser = (o: Parameters<typeof createUser>[0] = {}) =>
  createUser({ phoneVerified: true, consents: ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT'], ...o });

/** Polls `fn` until it returns a truthy value (the listeners run after the response). */
async function eventually<T>(
  fn: () => Promise<T | null | undefined | false>,
  label: string,
  timeoutMs = 5000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) throw new Error(`eventually: ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('enrollment hooks: invitation and invite-link courseIds (SP3 T9)', () => {
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

  async function personal(): Promise<{ teacher: User; workspace: Workspace }> {
    const teacher = await verifiedUser({ firstName: 'Mohamed', lastName: 'Ben Ali' });
    const workspace = await createPersonalWorkspace(teacher, { name: 'Espace de Mohamed' });
    return { teacher, workspace };
  }

  /** A PUBLISHED, a DRAFT, a deleted and an ARCHIVED course of `teacher`, plus a foreign one. */
  async function courses(workspace: Workspace, teacher: User) {
    const published = await createCourse(workspace, teacher, {
      status: 'PUBLISHED',
      title: 'Publié',
    });
    const draft = await createCourse(workspace, teacher, { title: 'Brouillon' });
    const deleted = await createCourse(workspace, teacher, { status: 'PUBLISHED' });
    await db.course.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const archived = await createCourse(workspace, teacher, { status: 'ARCHIVED' });
    const other = await verifiedUser();
    const { workspace: otherWs } = await createOrganization({
      owner: await createUser({ totpSecret: S }),
      teachers: [other],
    });
    const foreign = await createCourse(otherWs, other, { status: 'PUBLISHED' });
    return { published, draft, deleted, archived, foreign };
  }

  const enrollmentsOf = (studentUserId: string) =>
    db.enrollment.findMany({ where: { studentUserId }, orderBy: { createdAt: 'asc' } });

  it('accepting an invitation with courseIds enrolls the student (source INVITATION, assignedBy inviter); unknown or deleted ids are skipped; a join through an invite link with courseIds enrolls too (INVITE_LINK)', async () => {
    const { teacher, workspace } = await personal();
    const c = await courses(workspace, teacher);
    const ahmed = await createUser({ email: 'ahmed@example.com', birthDate: adultBirthDate() });
    const { token } = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: 'ahmed@example.com',
      courseIds: [
        c.published.id,
        c.draft.id,
        c.deleted.id,
        c.archived.id,
        c.foreign.id,
        randomUUID(),
      ],
    });
    await (
      await agent(ahmed)
    )
      .post(`/api/v1/invitations/${token}/accept`)
      .send({ mode: 'JOIN' })
      .expect(201);

    const rows = await eventually(async () => {
      const r = await enrollmentsOf(ahmed.id);
      return r.length >= 2 ? r : null;
    }, 'invitation enrollments');
    expect(rows.map((r) => r.courseId).sort()).toEqual([c.published.id, c.draft.id].sort());
    for (const r of rows) {
      expect(r).toMatchObject({
        workspaceId: workspace.id,
        status: 'ACTIVE',
        source: 'INVITATION',
        assignedByUserId: teacher.id,
      });
    }
    // Only the PUBLISHED course notifies at once (the DRAFT one at publication).
    await eventually(
      async () => ctx.queue.jobs.some((j) => j.name === COURSE_ASSIGNED_NOTIFY_JOB),
      'assigned job',
    );
    const jobs = ctx.queue.jobs.filter((j) => j.name === COURSE_ASSIGNED_NOTIFY_JOB);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data).toEqual({
      workspaceId: workspace.id,
      enrollmentIds: [rows.find((r) => r.courseId === c.published.id)!.id],
    });
    const audits = await eventually(async () => {
      const a = await db.auditLog.findMany({ where: { action: 'enrollment.created' } });
      return a.length >= 2 ? a : null;
    }, 'audit rows');
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ workspaceId: workspace.id, actorRole: 'SYSTEM' });
    expect(audits[0]!.after).toMatchObject({ source: 'INVITATION' });
    // The skipped ids are logged (ids only), never enrolled; nothing in the foreign workspace.
    expect(await db.enrollment.count({ where: { courseId: c.foreign.id } })).toBe(0);
    await eventually(
      async () =>
        ctx.logs
          .lines()
          .some((l) => l.msg === 'enrollment hook skipped course ids' && l.source === 'INVITATION'),
      'skip log',
    );
    const skip = ctx.logs.lines().find((l) => l.msg === 'enrollment hook skipped course ids')!;
    expect((skip.courseIds as string[]).length).toBe(4);

    // Invite link: the event is emitted and the student enrolled with source INVITE_LINK.
    const { link, code } = await createInviteLink({
      workspace,
      createdBy: teacher,
      courseIds: [c.published.id, c.deleted.id],
    });
    const sara = await createUser({ birthDate: adultBirthDate() });
    const joined: InviteLinkJoinedEvent[] = [];
    const emitter = ctx.app.get(EventEmitter2);
    const listener = (e: InviteLinkJoinedEvent) => joined.push(e);
    emitter.on(INVITE_LINK_JOINED, listener);
    try {
      await (
        await agent(sara)
      )
        .post(`/api/v1/join/${code}/accept`)
        .send({ mode: 'JOIN' })
        .expect(201);
      await new Promise((r) => setImmediate(r));
    } finally {
      emitter.off(INVITE_LINK_JOINED, listener);
    }
    expect(joined).toEqual([
      expect.objectContaining({
        workspaceId: workspace.id,
        inviteLinkId: link.id,
        userId: sara.id,
      }),
    ]);
    const [viaLink] = await eventually(async () => {
      const r = await enrollmentsOf(sara.id);
      return r.length >= 1 ? r : null;
    }, 'link enrollment');
    expect(viaLink).toMatchObject({
      courseId: c.published.id,
      status: 'ACTIVE',
      source: 'INVITE_LINK',
      assignedByUserId: teacher.id,
    });
  });

  it('a consent-pending minor is pre-assigned (access waits for the consent); a code with approval pre-assigns too and a rejection revokes', async () => {
    const { teacher, workspace } = await personal();
    const course = await createCourse(workspace, teacher, { status: 'PUBLISHED' });
    const kid = await createUser({ email: 'kid@example.com', birthDate: minorBirthDate() });
    const { token } = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: 'kid@example.com',
      guardianEmail: 'parent@example.com',
      birthDate: minorBirthDate(),
      courseIds: [course.id],
    });
    const res = await (
      await agent(kid)
    )
      .post(`/api/v1/invitations/${token}/accept`)
      .send({ mode: 'JOIN' })
      .expect(201);
    expect(res.body.membershipStatus).toBe('PENDING_GUARDIAN_CONSENT');
    await eventually(async () => (await enrollmentsOf(kid.id)).length === 1, 'minor enrollment');
    // The membership gates access, not the enrollment.
    await (await agent(kid)).get(`/api/v1/workspaces/${workspace.id}`).expect(403);

    // A code with approval: PENDING_APPROVAL student enrolled, then rejected → REVOKED.
    const { code } = await createInviteLink({
      workspace,
      createdBy: teacher,
      requiresApproval: true,
      courseIds: [course.id],
    });
    const late = await createUser({ birthDate: adultBirthDate() });
    const joined = await (
      await agent(late)
    )
      .post(`/api/v1/join/${code}/accept`)
      .send({ mode: 'JOIN' })
      .expect(201);
    expect(joined.body.membershipStatus).toBe('PENDING_APPROVAL');
    await eventually(
      async () => (await enrollmentsOf(late.id)).length === 1,
      'approval enrollment',
    );
    await (
      await agent(teacher)
    )
      .post(`/api/v1/workspaces/${workspace.id}/members/${late.id}/reject`)
      .expect(200);
    const revoked = await eventually(async () => {
      const [row] = await enrollmentsOf(late.id);
      return row?.status === 'REVOKED' ? row : null;
    }, 'rejection revokes');
    expect(revoked.revokedReason).toBe('MEMBERSHIP_REJECTED');
    const audit = await eventually(
      () =>
        db.auditLog.findFirst({ where: { action: 'enrollment.revoked', entityId: revoked.id } }),
      'revocation audit',
    );
    expect(audit).toMatchObject({ workspaceId: workspace.id, actorRole: 'SYSTEM' });
  });

  it('a hook never touches an enrollment that is already ACTIVE and never fails the request', async () => {
    const { teacher, workspace } = await personal();
    const course = await createCourse(workspace, teacher, { status: 'PUBLISHED' });
    const ahmed = await createUser({ email: 'ahmed@example.com', birthDate: adultBirthDate() });
    // A stale enrollment from an earlier membership (kept ACTIVE).
    const before = await createEnrollment(course, ahmed, { progressPercent: 30 });
    const { token } = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: 'ahmed@example.com',
      courseIds: [course.id],
    });
    await (
      await agent(ahmed)
    )
      .post(`/api/v1/invitations/${token}/accept`)
      .send({ mode: 'JOIN' })
      .expect(201);
    await new Promise((r) => setTimeout(r, 200));
    const [row] = await enrollmentsOf(ahmed.id);
    expect(row).toMatchObject({ id: before.id, source: 'MANUAL', progressPercent: 30 });
    expect(ctx.queue.jobs.filter((j) => j.name === COURSE_ASSIGNED_NOTIFY_JOB)).toEqual([]);
  });

  describe('courseIds are validated when an invitation or an invite link is created', () => {
    it("own, DRAFT and PUBLISHED courses are accepted; another workspace's, a deleted or an ARCHIVED one → 422 on courseIds[i]; staff invitations take no course", async () => {
      const { teacher, workspace } = await personal();
      const c = await courses(workspace, teacher);
      const t = await agent(teacher);
      const invitations = `/api/v1/workspaces/${workspace.id}/invitations`;
      const links = `/api/v1/workspaces/${workspace.id}/invite-links`;

      const ok = await t
        .post(invitations)
        .send({ email: 'ok@example.com', courseIds: [c.published.id, c.draft.id] })
        .expect(201);
      expect(ok.body.courseIds).toEqual([c.published.id, c.draft.id]);
      const okLink = await t
        .post(links)
        .send({ courseIds: [c.draft.id] })
        .expect(201);
      expect(okLink.body.courseIds).toEqual([c.draft.id]);

      for (const [bad, index] of [
        [[c.published.id, c.foreign.id], 1],
        [[c.deleted.id], 0],
        [[c.draft.id, c.published.id, c.archived.id], 2],
        [[randomUUID()], 0],
      ] as const) {
        const inv = await t
          .post(invitations)
          .send({ email: `bad-${index}-${bad.length}@example.com`, courseIds: bad })
          .expect(422);
        expect(inv.body.code).toBe('VALIDATION_FAILED');
        expect(inv.body.details.issues[0].path).toEqual(['courseIds', index]);
        const lnk = await t.post(links).send({ courseIds: bad }).expect(422);
        expect(lnk.body.details.issues[0].path).toEqual(['courseIds', index]);
      }
      expect(await db.invitation.count()).toBe(1);
      expect(await db.inviteLink.count()).toBe(1);
    });

    it('in an organisation a TEACHER names only his own courses; the OWNER any course of the workspace; a TEACHER/ADMIN invitation with courseIds → 422', async () => {
      const owner = await verifiedUser({ totpSecret: S });
      const teacher = await verifiedUser({ firstName: 'Teacher' });
      const teacher2 = await verifiedUser({ firstName: 'Teacher2' });
      const { workspace } = await createOrganization({ owner, teachers: [teacher, teacher2] });
      const mine = await createCourse(workspace, teacher, { status: 'PUBLISHED' });
      const theirs = await createCourse(workspace, teacher2, { status: 'PUBLISHED' });
      const invitations = `/api/v1/workspaces/${workspace.id}/invitations`;
      const links = `/api/v1/workspaces/${workspace.id}/invite-links`;
      const t = await agent(teacher);

      await t
        .post(invitations)
        .send({ email: 's1@example.com', courseIds: [mine.id] })
        .expect(201);
      const refused = await t
        .post(invitations)
        .send({ email: 's2@example.com', courseIds: [mine.id, theirs.id] })
        .expect(422);
      expect(refused.body.details.issues[0].path).toEqual(['courseIds', 1]);
      await t
        .post(links)
        .send({ courseIds: [theirs.id] })
        .expect(422);

      const o = await agent(owner);
      await o
        .post(invitations)
        .send({ email: 's3@example.com', courseIds: [mine.id, theirs.id] })
        .expect(201);
      const staff = await o
        .post(invitations)
        .send({ email: 't@example.com', role: 'TEACHER', courseIds: [mine.id] })
        .expect(422);
      expect(staff.body.details.issues[0].path).toEqual(['courseIds']);
    });
  });
});
