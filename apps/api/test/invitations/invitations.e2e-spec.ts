import { hashOpaqueToken } from '@nibras/contracts';
import type { PrismaClient, User, Workspace } from '@nibras/db';
import { extractFirstLink } from '@nibras/providers';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import {
  addMember,
  createInvitation,
  createOrganization,
  createPersonalWorkspace,
  createUser,
} from '../helpers/factories';

/** Base32 TOTP seed: organisation OWNER/ADMIN clear the 2FA gate with it. */
const S = 'JBSWY3DPEHPK3PXP';
const MIN = 60_000;
const DAY = 24 * 3600 * 1000;

type Agent = ReturnType<typeof as>;

/** A teacher who passes `@RequireVerifiedTeacher()`: email, phone, code of conduct. */
const verifiedUser = (o: Parameters<typeof createUser>[0] = {}) =>
  createUser({ phoneVerified: true, consents: ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT'], ...o });

describe('invitations API: create, list, get, update, resend, revoke (AC-INV-01, 04, 05, 06)', () => {
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
  const inv = (wid: string, path = '') => `/api/v1/workspaces/${wid}/invitations${path}`;

  /** A verified teacher (Mohamed) and his PERSONAL workspace. */
  async function personal(): Promise<{ teacher: User; workspace: Workspace; a: Agent }> {
    const teacher = await verifiedUser({ firstName: 'Mohamed', lastName: 'Ben Ali' });
    const workspace = await createPersonalWorkspace(teacher);
    return { teacher, workspace, a: await agent(teacher) };
  }

  /** An organisation with a verified OWNER, ADMIN and TEACHER. */
  async function organisation() {
    const owner = await verifiedUser({ totpSecret: S, firstName: 'Owner' });
    const admin = await verifiedUser({ totpSecret: S, firstName: 'Admin' });
    const teacher = await verifiedUser({ firstName: 'Teacher' });
    const { workspace } = await createOrganization({
      owner,
      admins: [admin],
      teachers: [teacher],
    });
    return { owner, admin, teacher, workspace };
  }

  it('AC-INV-01: a verified teacher invites ahmed@example.com → PENDING, expires in 7 d, email with a unique /invite/ link, no token in the response or the audit row', async () => {
    const { workspace, teacher } = await personal();
    const a = await agent(teacher);
    const res = await a
      .post(inv(workspace.id))
      .send({ email: 'Ahmed@Example.com', firstName: 'Ahmed', message: 'Bienvenue !' })
      .expect(201);
    expect(res.body).toMatchObject({
      email: 'ahmed@example.com',
      role: 'STUDENT',
      status: 'PENDING',
      firstName: 'Ahmed',
      invitedByUserId: teacher.id,
      invitedByName: 'Mohamed Ben Ali',
      resentCount: 0,
      teacherUserId: null,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);

    const [mail] = ctx.email.findByTemplate('invitation.received_student', 'ahmed@example.com');
    expect(mail).toBeDefined();
    expect(mail!.locale).toBe('fr');
    expect(mail!.params).toMatchObject({
      hasName: 'yes',
      firstName: 'Ahmed',
      inviterName: 'Mohamed Ben Ali',
      workspaceName: workspace.name,
      hasMessage: 'yes',
      message: 'Bienvenue !',
    });
    const link = extractFirstLink(mail!.html, '/invite/');
    expect(link).toMatch(/\/fr\/invite\/[A-Za-z0-9_-]{43}$/);

    const row = await db.invitation.findFirstOrThrow();
    expect(row.tokenHash).toBe(hashOpaqueToken(link!.split('/').pop()!));
    expect(+row.expiresAt - Date.now()).toBeGreaterThan(6.9 * DAY);
    expect(+row.expiresAt - Date.now()).toBeLessThanOrEqual(7 * DAY);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'invitation.created' } });
    expect(audit).toMatchObject({
      entityType: 'Invitation',
      entityId: row.id,
      actorUserId: teacher.id,
    });
    expect(audit.after).toMatchObject({ email: 'ahmed@example.com', role: 'STUDENT' });
    expect(JSON.stringify(audit.after)).not.toContain(row.tokenHash);
    expect(JSON.stringify(audit.after)).not.toContain(link!.split('/').pop()!);
    // The token never reaches the logs either.
    expect(JSON.stringify(ctx.logs.lines())).not.toContain(link!.split('/').pop()!);
  });

  it('the email goes out in the existing account locale with the date formatted there; neutral greeting without a name', async () => {
    const { workspace, a } = await personal();
    await createUser({ email: 'sara@example.com', locale: 'ar' });
    await a.post(inv(workspace.id)).send({ email: 'sara@example.com' }).expect(201);
    const [mail] = ctx.email.findByTemplate('invitation.received_student', 'sara@example.com');
    expect(mail!.locale).toBe('ar');
    expect(mail!.params).toMatchObject({ hasName: 'no', hasMessage: 'no' });
    expect(extractFirstLink(mail!.html, '/invite/')).toMatch(/\/ar\/invite\//);
    // Western digits, Gregorian calendar (formatted in the recipient locale, not an ISO string).
    expect(mail!.params.expiresAt).not.toMatch(/T\d{2}:/);
    expect(mail!.params.expiresAt).toMatch(/\d{4}/);
  });

  it('AC-SAFE-01: an unverified teacher gets 403 TEACHER_NOT_VERIFIED, no row, no email', async () => {
    const teacher = await createUser();
    const workspace = await createPersonalWorkspace(teacher);
    const res = await (
      await agent(teacher)
    )
      .post(inv(workspace.id))
      .send({ email: 'ahmed@example.com' })
      .expect(403);
    expect(res.body.code).toBe('TEACHER_NOT_VERIFIED');
    expect(await db.invitation.count()).toBe(0);
    expect(ctx.email.sent).toHaveLength(0);
  });

  it('AC-INV-06: an ACTIVE member (student or teacher) → 409 ALREADY_MEMBER, no row, no email; a REMOVED one may be invited again', async () => {
    const { owner, teacher, workspace } = await organisation();
    const student = await createUser({ email: 'student@example.com' });
    await addMember(workspace, student, 'STUDENT');
    const pending = await createUser({ email: 'pending@example.com' });
    await addMember(workspace, pending, 'STUDENT', { status: 'PENDING_GUARDIAN_CONSENT' });
    const gone = await createUser({ email: 'gone@example.com' });
    await addMember(workspace, gone, 'STUDENT', { status: 'REMOVED' });
    const a = await agent(owner);

    for (const email of ['Student@example.com', teacher.email, 'pending@example.com']) {
      const res = await a.post(inv(workspace.id)).send({ email }).expect(409);
      expect(res.body.code, email).toBe('ALREADY_MEMBER');
    }
    // Same address as staff: still one membership per workspace.
    await a
      .post(inv(workspace.id))
      .send({ email: 'student@example.com', role: 'TEACHER' })
      .expect(409);
    expect(await db.invitation.count()).toBe(0);
    expect(ctx.email.sent).toHaveLength(0);

    await a.post(inv(workspace.id)).send({ email: 'gone@example.com' }).expect(201);
  });

  it('a second PENDING invitation for the same email → 409 INVITATION_PENDING with the existing id; after revocation a new one is allowed', async () => {
    const { workspace, a } = await personal();
    const first = await a.post(inv(workspace.id)).send({ email: 'ahmed@example.com' }).expect(201);
    const dup = await a.post(inv(workspace.id)).send({ email: 'AHMED@example.com' }).expect(409);
    expect(dup.body).toMatchObject({
      code: 'INVITATION_PENDING',
      details: { invitationId: first.body.id },
    });
    await a.delete(inv(workspace.id, `/${first.body.id}`)).expect(204);
    const again = await a.post(inv(workspace.id)).send({ email: 'ahmed@example.com' }).expect(201);
    expect(again.body.id).not.toBe(first.body.id);
    expect(ctx.email.findByTemplate('invitation.received_student')).toHaveLength(2);
  });

  it('a concurrent duplicate create is decided by the partial unique index → one 201, one 409 INVITATION_PENDING', async () => {
    const { workspace, a } = await personal();
    const results = await Promise.all(
      [0, 1].map(() => a.post(inv(workspace.id)).send({ email: 'race@example.com' })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const conflict = results.find((r) => r.status === 409)!;
    expect(conflict.body.code).toBe('INVITATION_PENDING');
    expect(await db.invitation.count()).toBe(1);
  });

  it('AC-INV-04: resend replaces the token, pushes expiresAt by 7 d, increments resentCount; a second resend within 10 min → 429 with retryAfterS', async () => {
    const { workspace, teacher, a } = await personal();
    const { invitation, token } = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: 'late@example.com',
      expiresAt: new Date(Date.now() - 1000),
    });
    expect((await a.get(inv(workspace.id)).expect(200)).body.items[0].status).toBe('EXPIRED');

    // Sent at creation (lastSentAt = now): the cooldown applies to the first resend too.
    const early = await a.post(inv(workspace.id, `/${invitation.id}/resend`)).expect(429);
    expect(early.body.code).toBe('RATE_LIMITED');

    await db.invitation.update({
      where: { id: invitation.id },
      data: { lastSentAt: new Date(Date.now() - 11 * MIN) },
    });
    const r = await a.post(inv(workspace.id, `/${invitation.id}/resend`)).expect(200);
    expect(r.body).toMatchObject({ status: 'PENDING', resentCount: 1 });
    expect(JSON.stringify(r.body)).not.toMatch(/token/i);
    const row = await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(row.status).toBe('PENDING');
    expect(row.tokenHash).not.toBe(hashOpaqueToken(token));
    expect(+row.expiresAt - Date.now()).toBeGreaterThan(6.9 * DAY);
    const [mail] = ctx.email.findByTemplate('invitation.received_student', 'late@example.com');
    const raw = extractFirstLink(mail!.html, '/invite/')!.split('/').pop()!;
    expect(row.tokenHash).toBe(hashOpaqueToken(raw));
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'invitation.resent' } });
    expect(audit.after).toMatchObject({ resentCount: 1 });
    expect(JSON.stringify(audit)).not.toContain(row.tokenHash);

    const again = await a.post(inv(workspace.id, `/${invitation.id}/resend`)).expect(429);
    expect(again.body.code).toBe('RATE_LIMITED');
    expect(again.body.details.retryAfterS).toBeGreaterThan(0);
    expect(again.body.details.retryAfterS).toBeLessThanOrEqual(600);
    expect(ctx.email.findByTemplate('invitation.received_student')).toHaveLength(1);
  });

  it('two concurrent resends after the cooldown → one 200, one 429; resentCount = 1', async () => {
    const { workspace, teacher, a } = await personal();
    const { invitation } = await createInvitation({ workspace, invitedBy: teacher });
    await db.invitation.update({
      where: { id: invitation.id },
      data: { lastSentAt: new Date(Date.now() - 11 * MIN) },
    });
    const results = await Promise.all(
      [0, 1].map(() => a.post(inv(workspace.id, `/${invitation.id}/resend`))),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
    const row = await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(row.resentCount).toBe(1);
  });

  it('AC-INV-05: revoke → REVOKED (audited); resend or revoke of a revoked invitation → 409; an accepted one → 409 INVITATION_ALREADY_ACCEPTED', async () => {
    const { workspace, teacher, a } = await personal();
    const { invitation } = await createInvitation({ workspace, invitedBy: teacher });
    await a.delete(inv(workspace.id, `/${invitation.id}`)).expect(204);
    const row = await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(row.status).toBe('REVOKED');
    expect(row.revokedAt).not.toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'invitation.revoked' } });
    expect(audit).toMatchObject({ entityId: invitation.id });
    expect(audit.after).toMatchObject({ status: 'REVOKED' });
    expect((await a.get(inv(workspace.id, `/${invitation.id}`)).expect(200)).body.status).toBe(
      'REVOKED',
    );

    await db.invitation.update({
      where: { id: invitation.id },
      data: { lastSentAt: new Date(Date.now() - 11 * MIN) },
    });
    const resend = await a.post(inv(workspace.id, `/${invitation.id}/resend`)).expect(409);
    expect(resend.body.code).toBe('INVITATION_REVOKED');
    expect((await a.delete(inv(workspace.id, `/${invitation.id}`)).expect(409)).body.code).toBe(
      'INVITATION_REVOKED',
    );

    const student = await createUser();
    const { invitation: accepted } = await createInvitation({
      workspace,
      invitedBy: teacher,
      status: 'ACCEPTED',
      acceptedBy: student,
    });
    for (const call of [
      a.post(inv(workspace.id, `/${accepted.id}/resend`)),
      a.delete(inv(workspace.id, `/${accepted.id}`)),
      a.patch(inv(workspace.id, `/${accepted.id}`)).send({ firstName: 'X' }),
    ]) {
      const res = await call.expect(409);
      expect(res.body.code).toBe('INVITATION_ALREADY_ACCEPTED');
    }
    expect(ctx.email.sent).toHaveLength(0);
  });

  it('PATCH edits names, guardian email and message of a pending (or expired) invitation, audited with before/after; no change → no audit', async () => {
    const { workspace, teacher, a } = await personal();
    const { invitation } = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: 'kid@example.com',
      firstName: 'Old',
      message: 'hello',
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await a
      .patch(inv(workspace.id, `/${invitation.id}`))
      .send({ firstName: 'Yasmine', guardianEmail: 'Parent@Example.com', message: null })
      .expect(200);
    expect(res.body).toMatchObject({
      firstName: 'Yasmine',
      guardianEmail: 'parent@example.com',
      status: 'EXPIRED',
    });
    const row = await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(row.message).toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'invitation.updated' } });
    expect(audit.before).toEqual({ firstName: 'Old', guardianEmail: null, message: 'hello' });
    expect(audit.after).toEqual({
      firstName: 'Yasmine',
      guardianEmail: 'parent@example.com',
      message: null,
    });

    await a
      .patch(inv(workspace.id, `/${invitation.id}`))
      .send({ firstName: 'Yasmine' })
      .expect(200);
    expect(await db.auditLog.count({ where: { action: 'invitation.updated' } })).toBe(1);

    const same = await a
      .patch(inv(workspace.id, `/${invitation.id}`))
      .send({ guardianEmail: 'kid@example.com' })
      .expect(422);
    expect(same.body.code).toBe('VALIDATION_FAILED');
    await a
      .patch(inv(workspace.id, `/${invitation.id}`))
      .send({ email: 'x@example.com' })
      .expect(422);
  });

  it('staff invitations: TEACHER role needs an ORGANIZATION (422 on a personal workspace) and workspace.staff.manage (403 for an org TEACHER); an ADMIN invite sends invitation.received_staff', async () => {
    const { workspace: personalWs, a: personalAgent } = await personal();
    const onPersonal = await personalAgent
      .post(inv(personalWs.id))
      .send({ email: 'colleague@example.com', role: 'TEACHER' })
      .expect(422);
    expect(onPersonal.body.code).toBe('INVITATION_ROLE_NOT_ALLOWED');

    const { owner, admin, teacher, workspace } = await organisation();
    const asTeacher = await (
      await agent(teacher)
    )
      .post(inv(workspace.id))
      .send({ email: 'colleague@example.com', role: 'TEACHER' })
      .expect(403);
    expect(asTeacher.body.code).toBe('PERMISSION_DENIED');

    const created = await (
      await agent(admin)
    )
      .post(inv(workspace.id))
      .send({ email: 'new-admin@example.com', role: 'ADMIN' })
      .expect(201);
    expect(created.body).toMatchObject({ role: 'ADMIN', status: 'PENDING' });
    const [mail] = ctx.email.findByTemplate('invitation.received_staff', 'new-admin@example.com');
    expect(mail!.params).toMatchObject({
      role: 'ADMIN',
      inviterName: 'Admin User',
      workspaceName: workspace.name,
    });
    expect(extractFirstLink(mail!.html, '/invite/')).toMatch(/\/fr\/invite\/[A-Za-z0-9_-]{43}$/);
    await (
      await agent(owner)
    )
      .post(inv(workspace.id))
      .send({ email: 'new-teacher@example.com', role: 'TEACHER' })
      .expect(201);
    expect(ctx.email.findByTemplate('invitation.received_student')).toHaveLength(0);
  });

  it('scope own: an org TEACHER lists, reads and manages only his invitations and never staff rows; the ADMIN lists all', async () => {
    const { owner, admin, teacher, workspace } = await organisation();
    const other = await verifiedUser({ firstName: 'Other' });
    await addMember(workspace, other, 'TEACHER');
    const { invitation: mine } = await createInvitation({ workspace, invitedBy: teacher });
    const { invitation: theirs } = await createInvitation({ workspace, invitedBy: other });
    const { invitation: staff } = await createInvitation({
      workspace,
      invitedBy: owner,
      role: 'TEACHER',
    });
    const t = await agent(teacher);

    const list = await t.get(inv(workspace.id)).expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([mine.id]);
    await t.get(inv(workspace.id, `/${mine.id}`)).expect(200);
    for (const id of [theirs.id, staff.id]) {
      await t.get(inv(workspace.id, `/${id}`)).expect(404);
      await t
        .patch(inv(workspace.id, `/${id}`))
        .send({ firstName: 'X' })
        .expect(404);
      await t.post(inv(workspace.id, `/${id}/resend`)).expect(404);
      await t.delete(inv(workspace.id, `/${id}`)).expect(404);
    }

    const all = await (await agent(admin)).get(`${inv(workspace.id)}?limit=100`).expect(200);
    expect(all.body.items.map((i: { id: string }) => i.id).sort()).toEqual(
      [mine.id, theirs.id, staff.id].sort(),
    );
    const staffOnly = await (
      await agent(admin)
    )
      .get(`${inv(workspace.id)}?role=TEACHER`)
      .expect(200);
    expect(staffOnly.body.items.map((i: { id: string }) => i.id)).toEqual([staff.id]);
  });

  it('teacherUserId: ADMIN may target an ACTIVE teacher; a student or a removed teacher → 422; a TEACHER inviter is the implicit teacher', async () => {
    const { admin, teacher, workspace } = await organisation();
    const student = await createUser();
    await addMember(workspace, student, 'STUDENT');
    const removed = await createUser();
    await addMember(workspace, removed, 'TEACHER', { status: 'REMOVED' });
    const ad = await agent(admin);

    const ok = await ad
      .post(inv(workspace.id))
      .send({ email: 's1@example.com', teacherUserId: teacher.id })
      .expect(201);
    expect(ok.body.teacherUserId).toBe(teacher.id);
    for (const id of [student.id, removed.id, admin.id]) {
      const res = await ad
        .post(inv(workspace.id))
        .send({ email: 's2@example.com', teacherUserId: id })
        .expect(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details.issues[0].path).toEqual(['teacherUserId']);
    }

    const t = await agent(teacher);
    const implicit = await t.post(inv(workspace.id)).send({ email: 's3@example.com' }).expect(201);
    expect(implicit.body.teacherUserId).toBe(teacher.id);
    // A TEACHER can only name himself.
    await t
      .post(inv(workspace.id))
      .send({ email: 's4@example.com', teacherUserId: teacher.id })
      .expect(201);
    const other = await t
      .post(inv(workspace.id))
      .send({ email: 's5@example.com', teacherUserId: admin.id })
      .expect(403);
    expect(other.body.code).toBe('PERMISSION_DENIED');
  });

  it('list: derived status filters, q over email and names, keyset pagination newest first', async () => {
    const { workspace, teacher, a } = await personal();
    const created: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const { invitation } = await createInvitation({
        workspace,
        invitedBy: teacher,
        email: `p${i}@example.com`,
        ...(i === 2 && { firstName: 'Yasmine' }),
      });
      created.push(invitation.id);
    }
    const { invitation: expired } = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: 'old@example.com',
      expiresAt: new Date(Date.now() - 1000),
    });
    const { invitation: revoked } = await createInvitation({
      workspace,
      invitedBy: teacher,
      status: 'REVOKED',
    });

    const pending = await a.get(`${inv(workspace.id)}?status=PENDING&limit=100`).expect(200);
    expect(pending.body.items).toHaveLength(5);
    const exp = await a.get(`${inv(workspace.id)}?status=EXPIRED`).expect(200);
    expect(exp.body.items.map((i: { id: string }) => i.id)).toEqual([expired.id]);
    const rev = await a.get(`${inv(workspace.id)}?status=REVOKED`).expect(200);
    expect(rev.body.items.map((i: { id: string }) => i.id)).toEqual([revoked.id]);
    const q = await a.get(`${inv(workspace.id)}?q=yASm`).expect(200);
    expect(q.body.items.map((i: { id: string }) => i.id)).toEqual([created[2]]);
    const byEmail = await a.get(`${inv(workspace.id)}?q=P4@EXAMPLE`).expect(200);
    expect(byEmail.body.items.map((i: { id: string }) => i.id)).toEqual([created[4]]);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: { items: { id: string }[]; nextCursor: string | null } } = await a
        .get(`${inv(workspace.id)}?status=PENDING&limit=2${cursor ? `&cursor=${cursor}` : ''}`)
        .expect(200);
      seen.push(...page.body.items.map((i) => i.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual([...created].reverse());

    const unknown = await a
      .get(`${inv(workspace.id)}?cursor=0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b`)
      .expect(422);
    expect(unknown.body.code).toBe('VALIDATION_FAILED');
  });

  it('isolation: an invitation id of another workspace is 404 on every :id route and unusable as a cursor; a teacherUserId of another workspace → 422', async () => {
    const { workspace: a, a: agentA } = await personal();
    const tb = await verifiedUser();
    const b = await createPersonalWorkspace(tb);
    const { invitation: foreign } = await createInvitation({ workspace: b, invitedBy: tb });
    const { owner, workspace: org } = await organisation();
    const foreignTeacher = await verifiedUser();
    await createOrganization({ owner: await createUser(), teachers: [foreignTeacher] });

    await agentA.get(inv(a.id, `/${foreign.id}`)).expect(404);
    await agentA
      .patch(inv(a.id, `/${foreign.id}`))
      .send({ firstName: 'X' })
      .expect(404);
    await agentA.post(inv(a.id, `/${foreign.id}/resend`)).expect(404);
    await agentA.delete(inv(a.id, `/${foreign.id}`)).expect(404);
    await agentA.get(`${inv(a.id)}?cursor=${foreign.id}`).expect(422);
    await agentA.get(inv(a.id, '/not-a-uuid')).expect(404);
    // B's row is untouched.
    expect((await db.invitation.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe(
      'PENDING',
    );

    const res = await (
      await agent(owner)
    )
      .post(inv(org.id))
      .send({ email: 'x@example.com', teacherUserId: foreignTeacher.id })
      .expect(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(await db.invitation.count({ where: { teacherUserId: foreignTeacher.id } })).toBe(0);
  });

  it('a suspended workspace is read-only: list 200, create / resend / revoke → 423', async () => {
    const teacher = await verifiedUser();
    const workspace = await createPersonalWorkspace(teacher, { status: 'SUSPENDED' });
    const { invitation } = await createInvitation({ workspace, invitedBy: teacher });
    const a = await agent(teacher);
    await a.get(inv(workspace.id)).expect(200);
    await a.post(inv(workspace.id)).send({ email: 'x@example.com' }).expect(423);
    await a.post(inv(workspace.id, `/${invitation.id}/resend`)).expect(423);
    await a.delete(inv(workspace.id, `/${invitation.id}`)).expect(423);
    await a
      .patch(inv(workspace.id, `/${invitation.id}`))
      .send({ firstName: 'X' })
      .expect(423);
  });

  it('a failed email does not fail the invitation: 201, the row exists, the failure is logged without the link', async () => {
    const { workspace, a } = await personal();
    const spy = vi.spyOn(ctx.email, 'send').mockRejectedValueOnce(new Error('smtp down'));
    try {
      const res = await a.post(inv(workspace.id)).send({ email: 'ahmed@example.com' }).expect(201);
      expect(await db.invitation.count()).toBe(1);
      const line = ctx.logs
        .lines()
        .find((l) => l.msg === 'invitation email not sent' && l.invitationId === res.body.id);
      expect(line).toBeDefined();
      expect(JSON.stringify(line)).not.toMatch(/\/invite\//);
    } finally {
      spy.mockRestore();
    }
  });
});
