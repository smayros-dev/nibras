import { hashOpaqueToken } from '@nibras/contracts';
import type { GuardianLink, PrismaClient, User } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import {
  assign,
  createOrganization,
  createPersonalWorkspace,
  createStudent,
  createUser,
} from '../helpers/factories';
import { expectMinorInvariant } from '../helpers/invariants';

const S = 'JBSWY3DPEHPK3PXP';
const MINUTE = 60_000;

/** A teacher who passes `@RequireVerifiedTeacher()`. */
const verifiedUser = (o: Parameters<typeof createUser>[0] = {}) =>
  createUser({ phoneVerified: true, consents: ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT'], ...o });

const REGRANT = {
  guardianFirstName: 'Fatma',
  guardianLastName: 'Ben Ali',
  relationship: 'LEGAL_GUARDIAN',
  acceptNotice: true,
};

interface StudentItem {
  userId: string;
  firstName: string;
  lastName: string;
  email?: string;
  status: string;
  isMinor: boolean;
  invitedByUserId: string | null;
  guardian: {
    email?: string;
    emailMasked: string;
    status: string;
    consentExpiresAt: string | null;
  } | null;
  progressPercent: null;
  attendanceRate: null;
  lastActivityAt: null;
  courses: unknown[];
}

describe('students API: list, profile skeleton, guardian email (AC-WS-02 for students; Q1, Q7)', () => {
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
  const students = (wid: string) => `/api/v1/workspaces/${wid}/students`;
  const profile = (wid: string, uid: string) => `${students(wid)}/${uid}/profile`;
  const student = (wid: string, uid: string) => `${students(wid)}/${uid}`;

  it('AC-WS-02 (students): an org TEACHER with 2 assigned students of 50 lists 2 without emails; the ADMIN lists 50 with emails and guardian emails', async () => {
    const owner = await createUser({ totpSecret: S });
    const admin = await createUser({ totpSecret: S });
    const teacher = await createUser({ firstName: 'Karim' });
    const { workspace } = await createOrganization({ owner, admins: [admin], teachers: [teacher] });
    // Two minors in the teacher's scope: one he invited (Q7: he sees that guardian's email), one
    // assigned to him but invited by the owner (masked only).
    const invited = await createStudent({
      workspace,
      minor: true,
      status: 'PENDING_GUARDIAN_CONSENT',
      invitedBy: teacher,
      guardianEmail: 'invited-guardian@example.com',
      user: { lastName: 'Aaa' },
    });
    const assigned = await createStudent({
      workspace,
      minor: true,
      invitedBy: owner,
      guardianEmail: 'assigned-guardian@example.com',
      user: { lastName: 'Aab' },
    });
    await assign(workspace, teacher, assigned.user, owner);
    for (let i = 0; i < 48; i += 1) {
      await createStudent({ workspace, invitedBy: owner, user: { lastName: `Z${i}` } });
    }
    // Neither listed nor counted: a REMOVED student and a staff member.
    await createStudent({ workspace, status: 'REMOVED', invitedBy: teacher });

    const t = await (await agent(teacher)).get(students(workspace.id)).expect(200);
    const items = t.body.items as StudentItem[];
    expect(items.map((s) => s.userId)).toEqual([invited.user.id, assigned.user.id]);
    expect(t.body.nextCursor).toBeNull();
    for (const s of items) {
      expect(s).not.toHaveProperty('email');
      expect(s.isMinor).toBe(true);
      expect(s.guardian!.emailMasked).toMatch(/^[a-z]\*\*\*@example\.com$/);
    }
    expect(items[0]!.guardian).toMatchObject({
      email: 'invited-guardian@example.com',
      status: 'PENDING',
    });
    expect(items[1]!.guardian).not.toHaveProperty('email');
    expect(items[1]!.guardian!.status).toBe('ACTIVE');
    expect(JSON.stringify(t.body)).not.toContain('assigned-guardian@example.com');

    const a = await (
      await agent(admin)
    )
      .get(students(workspace.id))
      .query({ limit: 100 })
      .expect(200);
    const all = a.body.items as StudentItem[];
    expect(all).toHaveLength(50);
    expect(all.every((s) => typeof s.email === 'string' && s.email.includes('@'))).toBe(true);
    const assignedRow = all.find((s) => s.userId === assigned.user.id)!;
    expect(assignedRow.guardian!.email).toBe('assigned-guardian@example.com');
    expect(all.filter((s) => s.guardian !== null)).toHaveLength(2);
  });

  it('list carries guardian status and isMinor; status filter PENDING_GUARDIAN_CONSENT; q matches names; keyset pagination is stable (limit 2 over 5 rows, no duplicate, no gap)', async () => {
    const teacher = await verifiedUser();
    const workspace = await createPersonalWorkspace(teacher);
    const minor = await createStudent({
      workspace,
      minor: true,
      status: 'PENDING_GUARDIAN_CONSENT',
      invitedBy: teacher,
      user: { firstName: 'Ahmed', lastName: 'Trabelsi' },
    });
    const names = ['Ben Salah', 'Chaabane', 'Dridi', 'Essid'];
    const adults: Awaited<ReturnType<typeof createStudent>>[] = [];
    for (const lastName of names) {
      adults.push(await createStudent({ workspace, invitedBy: teacher, user: { lastName } }));
    }
    const removed = await createStudent({ workspace, status: 'REMOVED', invitedBy: teacher });
    const a = await agent(teacher);

    const res = await a.get(students(workspace.id)).expect(200);
    const items = res.body.items as StudentItem[];
    expect(items).toHaveLength(5);
    // The personal OWNER sees every student of his workspace with emails (all his).
    expect(items.every((s) => typeof s.email === 'string')).toBe(true);
    const m = items.find((s) => s.userId === minor.user.id)!;
    expect(m).toMatchObject({
      status: 'PENDING_GUARDIAN_CONSENT',
      isMinor: true,
      invitedByUserId: teacher.id,
      guardian: {
        email: minor.guardianLink!.guardianEmail,
        status: 'PENDING',
        consentExpiresAt: minor.guardianLink!.consentExpiresAt!.toISOString(),
      },
      progressPercent: null,
      attendanceRate: null,
      lastActivityAt: null,
      courses: [],
    });
    const adult = items.find((s) => s.userId === adults[0]!.user.id)!;
    expect(adult.isMinor).toBe(false);
    expect(adult.guardian).toBeNull();
    expect(items.map((s) => s.userId)).not.toContain(removed.user.id);

    const pending = await a
      .get(students(workspace.id))
      .query({ status: 'PENDING_GUARDIAN_CONSENT' })
      .expect(200);
    expect(pending.body.items.map((s: StudentItem) => s.userId)).toEqual([minor.user.id]);
    const gone = await a.get(students(workspace.id)).query({ status: 'REMOVED' }).expect(200);
    expect(gone.body.items.map((s: StudentItem) => s.userId)).toEqual([removed.user.id]);

    const q = await a.get(students(workspace.id)).query({ q: 'trabel' }).expect(200);
    expect(q.body.items.map((s: StudentItem) => s.userId)).toEqual([minor.user.id]);
    const q2 = await a.get(students(workspace.id)).query({ q: 'AHMED' }).expect(200);
    expect(q2.body.items.map((s: StudentItem) => s.userId)).toEqual([minor.user.id]);

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await a
        .get(students(workspace.id))
        .query({ limit: 2, ...(cursor && { cursor }) })
        .expect(200);
      expect(page.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.body.items.map((s: StudentItem) => s.userId));
      cursor = page.body.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(items.map((s) => s.userId));
    expect(new Set(seen).size).toBe(5);

    const bad = await a.get(students(workspace.id)).query({ cursor: 'not-a-cursor' }).expect(422);
    expect(bad.body.details.issues[0].path).toEqual(['cursor']);
  });

  it('profile: skeleton sections are empty arrays / null; invitedBy and assignedTeachers resolved by name; a REMOVED student is still readable by the teacher; an unassigned student → 404 for an org TEACHER', async () => {
    const owner = await createUser({ totpSecret: S, firstName: 'Mohamed', lastName: 'Smairi' });
    const teacher = await createUser({ firstName: 'Karim', lastName: 'Jlassi' });
    const { workspace } = await createOrganization({ owner, teachers: [teacher] });
    const s = await createStudent({
      workspace,
      minor: true,
      invitedBy: owner,
      guardianEmail: 'fatma@example.com',
      user: { firstName: 'Ahmed', lastName: 'Ben Ali', locale: 'ar', timezone: 'Africa/Tunis' },
    });
    await assign(workspace, teacher, s.user, owner);
    const other = await createStudent({ workspace, invitedBy: owner });

    const o = await agent(owner);
    const res = await o.get(profile(workspace.id, s.user.id)).expect(200);
    expect(res.body).toEqual({
      user: {
        firstName: 'Ahmed',
        lastName: 'Ben Ali',
        email: s.user.email,
        locale: 'ar',
        timezone: 'Africa/Tunis',
        isMinor: true,
      },
      membership: {
        status: 'ACTIVE',
        joinedAt: expect.any(String),
        invitedBy: { firstName: 'Mohamed', lastName: 'Smairi' },
        removedAt: null,
      },
      guardian: {
        email: 'fatma@example.com',
        emailMasked: 'f***@example.com',
        firstName: null,
        lastName: null,
        relationship: null,
        status: 'ACTIVE',
        grantedAt: expect.any(String),
        consentExpiresAt: null,
        revokedAt: null,
      },
      assignedTeachers: [{ userId: teacher.id, firstName: 'Karim', lastName: 'Jlassi' }],
      courses: [],
      progress: null,
      sessions: [],
      attendance: null,
      reports: [],
      activity: [],
    });

    const t = await agent(teacher);
    const tp = await t.get(profile(workspace.id, s.user.id)).expect(200);
    expect(tp.body.user).not.toHaveProperty('email');
    expect(tp.body.guardian).not.toHaveProperty('email');
    expect(tp.body.guardian.emailMasked).toBe('f***@example.com');
    expect(JSON.stringify(tp.body)).not.toContain('fatma@example.com');

    expect((await t.get(profile(workspace.id, other.user.id)).expect(404)).body.code).toBe(
      'NOT_FOUND',
    );
    // A staff member is not a student.
    await o.get(profile(workspace.id, teacher.id)).expect(404);
    await o.get(profile(workspace.id, 'not-a-uuid')).expect(404);

    await db.membership.update({
      where: { id: s.membership.id },
      data: { status: 'REMOVED', removedAt: new Date() },
    });
    const removed = await t.get(profile(workspace.id, s.user.id)).expect(200);
    expect(removed.body.membership).toMatchObject({
      status: 'REMOVED',
      removedAt: expect.any(String),
    });
    await o.get(profile(workspace.id, s.user.id)).expect(200);
  });

  it('PATCH guardianEmail: adult → 422; same as student → 422 GUARDIAN_EMAIL_INVALID; pending minor → link email replaced, new consent email to the new address, audit guardian.email_changed with masked values', async () => {
    const teacher = await verifiedUser({ firstName: 'Mohamed' });
    const workspace = await createPersonalWorkspace(teacher);
    const a = await agent(teacher);

    const adult = await createStudent({ workspace, invitedBy: teacher });
    const r1 = await a
      .patch(student(workspace.id, adult.user.id))
      .send({ guardianEmail: 'g@example.com' })
      .expect(422);
    expect(r1.body.code).toBe('VALIDATION_FAILED');
    expect(r1.body.details.issues[0].path).toEqual(['guardianEmail']);

    const s = await createStudent({
      workspace,
      minor: true,
      status: 'PENDING_GUARDIAN_CONSENT',
      invitedBy: teacher,
      guardianEmail: 'old-guardian@example.com',
      user: { email: 'ahmed@example.com' },
    });
    const r2 = await a
      .patch(student(workspace.id, s.user.id))
      .send({ guardianEmail: 'Ahmed@Example.com' })
      .expect(422);
    expect(r2.body.code).toBe('GUARDIAN_EMAIL_INVALID');
    // `.strict()`: names are not editable here once the account exists (Q1).
    await a.patch(student(workspace.id, s.user.id)).send({ firstName: 'X' }).expect(422);

    const res = await a
      .patch(student(workspace.id, s.user.id))
      .send({ guardianEmail: 'new-guardian@example.com' })
      .expect(200);
    expect(res.body).toMatchObject({
      userId: s.user.id,
      status: 'PENDING_GUARDIAN_CONSENT',
      guardian: { email: 'new-guardian@example.com', status: 'PENDING' },
    });
    const link = await db.guardianLink.findUniqueOrThrow({ where: { id: s.guardianLink!.id } });
    expect(link.guardianEmail).toBe('new-guardian@example.com');
    expect(link.consentResentCount).toBe(0);
    expect(link.consentTokenHash).not.toBe(hashOpaqueToken(s.consentToken!));
    // The old guardian's consent link is dead; the new address got a working one.
    await http.get(`/api/v1/guardian-consent/${s.consentToken}`).expect(410);
    expect(
      ctx.email.findByTemplate('guardian.consent_requested', 'old-guardian@example.com'),
    ).toEqual([]);
    const mails = ctx.email.findByTemplate(
      'guardian.consent_requested',
      'new-guardian@example.com',
    );
    expect(mails).toHaveLength(1);
    const raw = (mails[0]!.params.link as string).split('/').pop()!;
    expect(hashOpaqueToken(raw)).toBe(link.consentTokenHash);
    await http.get(`/api/v1/guardian-consent/${raw}`).expect(200);

    const changed = await db.auditLog.findMany({ where: { action: 'guardian.email_changed' } });
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      entityType: 'GuardianLink',
      entityId: link.id,
      workspaceId: workspace.id,
      before: { guardianEmailMasked: 'o***@example.com' },
      after: { guardianEmailMasked: 'n***@example.com' },
    });
    expect(JSON.stringify(changed[0])).not.toMatch(/old-guardian|new-guardian/);
    expect(await db.auditLog.count({ where: { action: 'student.updated' } })).toBe(1);
    const requested = await db.auditLog.findMany({
      where: { action: 'guardian.consent_requested' },
    });
    expect(requested).toHaveLength(1);
    expect(JSON.stringify(requested)).not.toContain('new-guardian@example.com');

    // An address change has no cooldown (the 10-minute window is for resends to one address).
    await a
      .patch(student(workspace.id, s.user.id))
      .send({ guardianEmail: 'third@example.com' })
      .expect(200);
    expect(
      ctx.email.findByTemplate('guardian.consent_requested', 'third@example.com'),
    ).toHaveLength(1);
    // The same address again: nothing to change, nothing sent, nothing audited.
    await a
      .patch(student(workspace.id, s.user.id))
      .send({ guardianEmail: 'third@example.com' })
      .expect(200);
    expect(ctx.email.findByTemplate('guardian.consent_requested')).toHaveLength(2);
    expect(await db.auditLog.count({ where: { action: 'guardian.email_changed' } })).toBe(2);
    await expectMinorInvariant(db, workspace.id);
  });

  it("PATCH guardianEmail after a revocation clears the old guardian's page token (no re-grant, no view) and asks the new guardian; the membership stays suspended", async () => {
    const teacher = await verifiedUser();
    const workspace = await createPersonalWorkspace(teacher);
    const s = await createStudent({
      workspace,
      minor: true,
      status: 'SUSPENDED_CONSENT_REVOKED',
      invitedBy: teacher,
      guardianEmail: 'old@example.com',
    });
    expect(s.pageToken).toBeDefined();

    await (
      await agent(teacher)
    )
      .patch(student(workspace.id, s.user.id))
      .send({ guardianEmail: 'new@example.com' })
      .expect(200);
    const link = await db.guardianLink.findUniqueOrThrow({ where: { id: s.guardianLink!.id } });
    expect(link).toMatchObject({
      guardianEmail: 'new@example.com',
      status: 'PENDING',
      sessionsViewTokenHash: null,
    });
    const regrant = await http.post(`/api/v1/guardian/${s.pageToken}/grant`).send(REGRANT);
    expect(regrant.status).toBe(410);
    expect(regrant.body.code).toBe('TOKEN_INVALID');
    await http.get(`/api/v1/guardian/${s.pageToken}`).expect(410);
    expect(ctx.email.findByTemplate('guardian.consent_requested', 'new@example.com')).toHaveLength(
      1,
    );
    expect((await db.membership.findUniqueOrThrow({ where: { id: s.membership.id } })).status).toBe(
      'SUSPENDED_CONSENT_REVOKED',
    );
    expect(
      await db.consent.count({
        where: { userId: s.user.id, type: 'GUARDIAN_PARENTAL', revokedAt: null },
      }),
    ).toBe(0);
    await expectMinorInvariant(db, workspace.id);
  });

  it('PATCH guardianEmail: an ACTIVE consent → 409 CONSENT_ALREADY_DECIDED (nothing changes); a PENDING_APPROVAL minor → email recorded, nothing sent; a STUDENT → 403; an org TEACHER on an unassigned student → 404', async () => {
    const owner = await verifiedUser({ totpSecret: S });
    const teacher = await verifiedUser();
    const { workspace } = await createOrganization({ owner, teachers: [teacher] });
    const o = await agent(owner);

    const active = await createStudent({ workspace, minor: true, invitedBy: owner });
    const r = await o
      .patch(student(workspace.id, active.user.id))
      .send({ guardianEmail: 'other@example.com' })
      .expect(409);
    expect(r.body.code).toBe('CONSENT_ALREADY_DECIDED');
    const kept = await db.guardianLink.findUniqueOrThrow({
      where: { id: active.guardianLink!.id },
    });
    expect(kept).toEqual(active.guardianLink as GuardianLink);
    await http.get(`/api/v1/guardian/${active.pageToken}`).expect(200);

    const waiting = await createStudent({
      workspace,
      minor: true,
      status: 'PENDING_APPROVAL',
      invitedBy: owner,
    });
    await db.guardianLink.update({
      where: { id: waiting.guardianLink!.id },
      data: { consentTokenHash: null, consentExpiresAt: null, consentSentAt: null },
    });
    await o
      .patch(student(workspace.id, waiting.user.id))
      .send({ guardianEmail: 'recorded@example.com' })
      .expect(200);
    const recorded = await db.guardianLink.findUniqueOrThrow({
      where: { id: waiting.guardianLink!.id },
    });
    expect(recorded).toMatchObject({
      guardianEmail: 'recorded@example.com',
      status: 'PENDING',
      consentTokenHash: null,
      consentSentAt: null,
    });
    expect(ctx.email.findByTemplate('guardian.consent_requested')).toEqual([]);

    // Verified like a teacher, so the service (not the verification guard) is what refuses.
    const self = await createStudent({
      workspace,
      minor: true,
      status: 'ACTIVE',
      invitedBy: owner,
      user: { phoneVerified: true, consents: ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT'] },
    });
    const own = await (
      await agent(self.user)
    )
      .patch(student(workspace.id, self.user.id))
      .send({ guardianEmail: 'me-again@example.com' })
      .expect(403);
    expect(own.body.code).toBe('PERMISSION_DENIED');

    const unassigned = await createStudent({
      workspace,
      minor: true,
      status: 'PENDING_GUARDIAN_CONSENT',
      invitedBy: owner,
    });
    await (
      await agent(teacher)
    )
      .patch(student(workspace.id, unassigned.user.id))
      .send({ guardianEmail: 'x@example.com' })
      .expect(404);
    await expectMinorInvariant(db, workspace.id);
  });

  it('resend-consent route → 200 with the guardian info, then the GuardianRequestService cooldown (429)', async () => {
    const teacher = await verifiedUser();
    const workspace = await createPersonalWorkspace(teacher);
    const s = await createStudent({
      workspace,
      minor: true,
      status: 'PENDING_GUARDIAN_CONSENT',
      invitedBy: teacher,
    });
    await db.guardianLink.update({
      where: { id: s.guardianLink!.id },
      data: { consentSentAt: new Date(Date.now() - 30 * MINUTE) },
    });
    const a = await agent(teacher);
    const url = `${student(workspace.id, s.user.id)}/guardian/resend-consent`;
    const ok = await a.post(url).expect(200);
    expect(ok.body).toMatchObject({ status: 'PENDING', emailMasked: expect.any(String) });
    const again = await a.post(url).expect(429);
    expect(again.body.code).toBe('RATE_LIMITED');
  });
});
