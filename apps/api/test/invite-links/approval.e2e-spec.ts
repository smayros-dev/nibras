import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaClient, User, Workspace } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MEMBERSHIP_ACTIVATED,
  MEMBERSHIP_DEACTIVATED,
  type MembershipActivatedEvent,
  type MembershipDeactivatedEvent,
} from '../../src/members/events';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import {
  adultBirthDate,
  createInviteLink,
  createOrganization,
  createPersonalWorkspace,
  createStudent,
  createUser,
  minorBirthDate,
} from '../helpers/factories';
import { expectMinorInvariant } from '../helpers/invariants';

const S = 'JBSWY3DPEHPK3PXP';

/** A teacher who passes `@RequireVerifiedTeacher()`. */
const verifiedUser = (o: Parameters<typeof createUser>[0] = {}) =>
  createUser({ phoneVerified: true, consents: ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT'], ...o });

describe('approval queue: approve / reject (AC-INV-08; D5; Review Focus 2)', () => {
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
  const approve = (wid: string, uid: string) => `/api/v1/workspaces/${wid}/members/${uid}/approve`;
  const reject = (wid: string, uid: string) => `/api/v1/workspaces/${wid}/members/${uid}/reject`;

  const statusOf = async (workspace: Pick<Workspace, 'id'>, user: Pick<User, 'id'>) =>
    (
      await db.membership.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
      })
    ).status;

  /** Mohamed's PERSONAL workspace with an approval-required code. */
  async function personal() {
    const teacher = await verifiedUser({ firstName: 'Mohamed', lastName: 'Ben Ali' });
    const workspace = await createPersonalWorkspace(teacher, { name: 'Espace de Mohamed' });
    const { code } = await createInviteLink({
      workspace,
      createdBy: teacher,
      requiresApproval: true,
    });
    return { teacher, workspace, code };
  }

  /** `user` joins with `code` (JOIN mode) and waits for approval. */
  async function joinPending(user: User, code: string, body: Record<string, unknown> = {}) {
    const res = await (
      await agent(user)
    )
      .post(`/api/v1/join/${code}/accept`)
      .send({ mode: 'JOIN', ...body })
      .expect(201);
    expect(res.body.membershipStatus).toBe('PENDING_APPROVAL');
  }

  async function collect<T>(event: string, fn: () => Promise<void>): Promise<T[]> {
    const events: T[] = [];
    const emitter = ctx.app.get(EventEmitter2);
    const listener = (e: T) => events.push(e);
    emitter.on(event, listener);
    try {
      await fn();
      await new Promise((r) => setImmediate(r));
    } finally {
      emitter.off(event, listener);
    }
    return events;
  }

  it('approve → ACTIVE (joinedAt), member.approved audited, join.approved emailed, MembershipActivatedEvent; the student can enter', async () => {
    const { teacher, workspace, code } = await personal();
    const student = await createUser({ firstName: 'Ahmed', birthDate: adultBirthDate() });
    await joinPending(student, code);
    const a = await agent(teacher);

    const events = await collect<MembershipActivatedEvent>(MEMBERSHIP_ACTIVATED, async () => {
      const res = await a.post(approve(workspace.id, student.id)).expect(200);
      expect(res.body).toMatchObject({
        userId: student.id,
        role: 'STUDENT',
        status: 'ACTIVE',
        email: student.email,
      });
      expect(res.body.joinedAt).not.toBeNull();
    });
    expect(events).toEqual([
      expect.objectContaining({ workspaceId: workspace.id, userId: student.id }),
    ]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'member.approved' } });
    expect(audit.before).toMatchObject({ status: 'PENDING_APPROVAL' });
    expect(audit.after).toMatchObject({ status: 'ACTIVE' });
    const mail = ctx.email.findByTemplate('join.approved', student.email);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.html).toContain('Espace de Mohamed');
    await (await agent(student)).get(`/api/v1/workspaces/${workspace.id}`).expect(200);
    await expectMinorInvariant(db, workspace.id);

    // Approving twice: no longer pending.
    const again = await a.post(approve(workspace.id, student.id)).expect(409);
    expect(again.body.code).toBe('MEMBERSHIP_NOT_PENDING');
  });

  it('D5: approving a minor → PENDING_GUARDIAN_CONSENT and only now the consent email (naming the workspace and teacher); expectMinorInvariant', async () => {
    const { teacher, workspace, code } = await personal();
    const minor = await createUser({ firstName: 'Yasmine', birthDate: minorBirthDate() });
    await joinPending(minor, code, { guardianEmail: 'parent@example.com' });
    expect(ctx.email.findByTemplate('guardian.consent_requested')).toHaveLength(0);

    const events = await collect<MembershipActivatedEvent>(MEMBERSHIP_ACTIVATED, async () => {
      const res = await (await agent(teacher)).post(approve(workspace.id, minor.id)).expect(200);
      expect(res.body.status).toBe('PENDING_GUARDIAN_CONSENT');
    });
    expect(events).toHaveLength(0);
    const link = await db.guardianLink.findUniqueOrThrow({
      where: { studentUserId_workspaceId: { studentUserId: minor.id, workspaceId: workspace.id } },
    });
    expect(link).toMatchObject({ status: 'PENDING', guardianEmail: 'parent@example.com' });
    expect(link.consentTokenHash).not.toBeNull();
    expect(link.consentExpiresAt).not.toBeNull();
    const mail = ctx.email.findByTemplate('guardian.consent_requested', 'parent@example.com');
    expect(mail).toHaveLength(1);
    expect(mail[0]!.html).toContain('Espace de Mohamed');
    expect(mail[0]!.html).toContain('Mohamed Ben Ali');
    expect(await db.auditLog.count({ where: { action: 'guardian.consent_requested' } })).toBe(1);
    expect(ctx.email.findByTemplate('join.approved', minor.email)).toHaveLength(1);
    await expectMinorInvariant(db, workspace.id);
    const blocked = await (
      await agent(minor)
    )
      .get(`/api/v1/workspaces/${workspace.id}`)
      .expect(403);
    expect(blocked.body.code).toBe('GUARDIAN_CONSENT_REQUIRED');
  });

  it('Review Focus 2: an adult account that joined with a minor body birth date is treated as a minor at approval', async () => {
    const { teacher, workspace, code } = await personal();
    const student = await createUser({ birthDate: adultBirthDate() });
    await joinPending(student, code, {
      birthDate: minorBirthDate(),
      guardianEmail: 'parent@example.com',
    });
    const res = await (await agent(teacher)).post(approve(workspace.id, student.id)).expect(200);
    expect(res.body.status).toBe('PENDING_GUARDIAN_CONSENT');
    await expectMinorInvariant(db, workspace.id);
  });

  it('a minor already holding an active consent for this workspace is ACTIVE at approval, without a new consent cycle', async () => {
    const { teacher, workspace } = await personal();
    const { user } = await createStudent({
      workspace,
      minor: true,
      status: 'PENDING_APPROVAL',
      guardianStatus: 'ACTIVE',
      invitedBy: teacher,
    });
    // createGuardianLink with ACTIVE writes the consent row.
    const res = await (await agent(teacher)).post(approve(workspace.id, user.id)).expect(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(ctx.email.findByTemplate('guardian.consent_requested')).toHaveLength(0);
    await expectMinorInvariant(db, workspace.id);
  });

  it('a minor with no guardian address on record cannot be approved (422 GUARDIAN_EMAIL_REQUIRED, still pending)', async () => {
    const { teacher, workspace } = await personal();
    const minor = await createUser({ birthDate: minorBirthDate() });
    await db.membership.create({
      data: {
        workspaceId: workspace.id,
        userId: minor.id,
        role: 'STUDENT',
        status: 'PENDING_APPROVAL',
        invitedByUserId: teacher.id,
      },
    });
    const res = await (await agent(teacher)).post(approve(workspace.id, minor.id)).expect(422);
    expect(res.body.code).toBe('GUARDIAN_EMAIL_REQUIRED');
    expect(await statusOf(workspace, minor)).toBe('PENDING_APPROVAL');
    await expectMinorInvariant(db, workspace.id);
  });

  it('reject → REJECTED (removedAt, removalReason), member.rejected audited, join.rejected emailed, MembershipDeactivatedEvent; the student is then a stranger (404)', async () => {
    const { teacher, workspace, code } = await personal();
    const student = await createUser({ birthDate: adultBirthDate() });
    await joinPending(student, code);
    const events = await collect<MembershipDeactivatedEvent>(MEMBERSHIP_DEACTIVATED, async () => {
      const res = await (await agent(teacher)).post(reject(workspace.id, student.id)).expect(200);
      expect(res.body.status).toBe('REJECTED');
    });
    expect(events).toEqual([
      expect.objectContaining({
        workspaceId: workspace.id,
        userId: student.id,
        status: 'REJECTED',
        reason: 'REJECTED',
      }),
    ]);
    const m = await db.membership.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: student.id } },
    });
    expect(m).toMatchObject({ status: 'REJECTED', removalReason: 'REJECTED' });
    expect(m.removedAt).not.toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'member.rejected' } });
    expect(audit.after).toMatchObject({ status: 'REJECTED' });
    expect(ctx.email.findByTemplate('join.rejected', student.email)).toHaveLength(1);
    await (await agent(student)).get(`/api/v1/workspaces/${workspace.id}`).expect(404);
    const again = await (await agent(teacher)).post(reject(workspace.id, student.id)).expect(409);
    expect(again.body.code).toBe('MEMBERSHIP_NOT_PENDING');
  });

  it('a non-pending member → 409 MEMBERSHIP_NOT_PENDING; an unknown, malformed or other-workspace uid → 404', async () => {
    const { teacher, workspace } = await personal();
    const { user: active } = await createStudent({ workspace, invitedBy: teacher });
    const a = await agent(teacher);
    expect((await a.post(approve(workspace.id, active.id)).expect(409)).body.code).toBe(
      'MEMBERSHIP_NOT_PENDING',
    );
    expect((await a.post(reject(workspace.id, active.id)).expect(409)).body.code).toBe(
      'MEMBERSHIP_NOT_PENDING',
    );
    await a.post(approve(workspace.id, (await createUser()).id)).expect(404);
    await a.post(approve(workspace.id, 'not-a-uuid')).expect(404);

    const other = await verifiedUser();
    const b = await createPersonalWorkspace(other);
    const { user: foreign } = await createStudent({
      workspace: b,
      status: 'PENDING_APPROVAL',
      invitedBy: other,
    });
    await a.post(approve(workspace.id, foreign.id)).expect(404);
    await a.post(reject(workspace.id, foreign.id)).expect(404);
    expect(await statusOf(b, foreign)).toBe('PENDING_APPROVAL');
  });

  it('organisation: a TEACHER approves only the students of his own links (404 otherwise); the ADMIN approves any; a student has no student.invite', async () => {
    const owner = await verifiedUser({ totpSecret: S });
    const admin = await verifiedUser({ totpSecret: S });
    const teacher = await verifiedUser({ firstName: 'Leila' });
    const teacher2 = await verifiedUser({ firstName: 'Sami' });
    const { workspace } = await createOrganization({
      owner,
      admins: [admin],
      teachers: [teacher, teacher2],
    });
    const mine = await createInviteLink({ workspace, createdBy: teacher, requiresApproval: true });
    const theirs = await createInviteLink({
      workspace,
      createdBy: teacher2,
      requiresApproval: true,
    });
    const s1 = await createUser({ birthDate: adultBirthDate() });
    const s2 = await createUser({ birthDate: adultBirthDate() });
    await joinPending(s1, mine.code);
    await joinPending(s2, theirs.code);

    const asTeacher = await agent(teacher);
    await asTeacher.post(approve(workspace.id, s2.id)).expect(404);
    await asTeacher.post(reject(workspace.id, s2.id)).expect(404);
    const ok = await asTeacher.post(approve(workspace.id, s1.id)).expect(200);
    expect(ok.body.status).toBe('ACTIVE');
    // Scope own: no email in the summary.
    expect(ok.body.email).toBeUndefined();

    await (await agent(admin)).post(reject(workspace.id, s2.id)).expect(200);
    await (await agent(s1)).post(approve(workspace.id, s2.id)).expect(403);
  });

  it('a suspended workspace refuses approvals (423)', async () => {
    const teacher = await verifiedUser();
    const workspace = await createPersonalWorkspace(teacher, { status: 'SUSPENDED' });
    const { user } = await createStudent({
      workspace,
      status: 'PENDING_APPROVAL',
      invitedBy: teacher,
    });
    await (await agent(teacher)).post(approve(workspace.id, user.id)).expect(423);
    expect(await statusOf(workspace, user)).toBe('PENDING_APPROVAL');
  });
});
