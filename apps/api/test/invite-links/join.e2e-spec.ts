import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaClient, User, Workspace } from '@nibras/db';
import { extractFirstLink } from '@nibras/providers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MEMBERSHIP_ACTIVATED, type MembershipActivatedEvent } from '../../src/members/events';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs, setCookies } from '../helpers/auth';
import {
  adultBirthDate,
  createInviteLink,
  createOrganization,
  createPersonalWorkspace,
  createUser,
  minorBirthDate,
} from '../helpers/factories';
import { expectMinorInvariant } from '../helpers/invariants';

const S = 'JBSWY3DPEHPK3PXP';
const PASSWORD = 'un mot de passe assez long';

/** A teacher who passes `@RequireVerifiedTeacher()`. */
const verifiedUser = (o: Parameters<typeof createUser>[0] = {}) =>
  createUser({ phoneVerified: true, consents: ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT'], ...o });

const register = (patch: Record<string, unknown> = {}) => ({
  mode: 'REGISTER',
  email: 'ahmed@example.com',
  firstName: 'Ahmed',
  lastName: 'Trabelsi',
  password: PASSWORD,
  locale: 'fr',
  timezone: 'Africa/Tunis',
  birthDate: adultBirthDate(),
  acceptTerms: true,
  acceptPrivacy: true,
  ...patch,
});

describe('public join by group code (AC-INV-08; Review Focus 2, 3)', () => {
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
  const preview = (code: string) => `/api/v1/join/${code}`;
  const accept = (code: string) => `/api/v1/join/${code}/accept`;

  async function personal(o: Partial<Pick<Workspace, 'status'>> = {}) {
    const teacher = await verifiedUser({ firstName: 'Mohamed', lastName: 'Ben Ali' });
    const workspace = await createPersonalWorkspace(teacher, {
      name: 'Espace de Mohamed',
      ...(o.status && { status: o.status }),
    });
    return { teacher, workspace };
  }

  const membership = (workspace: Pick<Workspace, 'id'>, user: Pick<User, 'id'>) =>
    db.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    });

  it('preview: anonymous → workspace, teacher, approval flag, ANONYMOUS; signed in → SIGNED_IN; the code is case-insensitive; unknown or malformed → 404; disabled / exhausted / expired → 410', async () => {
    const { teacher, workspace } = await personal();
    const { code } = await createInviteLink({
      workspace,
      createdBy: teacher,
      requiresApproval: true,
    });
    const anon = await http.get(preview(code.toLowerCase())).expect(200);
    expect(anon.body).toEqual({
      workspace: { id: workspace.id, name: 'Espace de Mohamed', type: 'PERSONAL' },
      teacher: { firstName: 'Mohamed', lastName: 'Ben Ali' },
      requiresApproval: true,
      viewer: 'ANONYMOUS',
      accountRequired: true,
    });
    const student = await createUser();
    const signed = await (await agent(student)).get(preview(code)).expect(200);
    expect(signed.body).toMatchObject({ viewer: 'SIGNED_IN', accountRequired: false });

    expect((await http.get(preview('ZZZZZZZZ')).expect(404)).body.code).toBe('NOT_FOUND');
    await http.get(preview('not-a-code')).expect(404);
    await http.post(accept('ZZZZZZZZ')).send({ mode: 'JOIN' }).expect(404);

    const disabled = await createInviteLink({ workspace, createdBy: teacher, status: 'DISABLED' });
    const exhausted = await createInviteLink({
      workspace,
      createdBy: teacher,
      maxUses: 2,
      usesCount: 2,
    });
    const expired = await createInviteLink({
      workspace,
      createdBy: teacher,
      expiresAt: new Date(Date.now() - 1000),
    });
    for (const [c, expected] of [
      [disabled.code, 'INVITE_LINK_DISABLED'],
      [exhausted.code, 'INVITE_LINK_EXHAUSTED'],
      [expired.code, 'INVITE_LINK_EXPIRED'],
    ] as const) {
      expect((await http.get(preview(c)).expect(410)).body.code).toBe(expected);
      const acc = await (await agent(student)).post(accept(c)).send({ mode: 'JOIN' }).expect(410);
      expect(acc.body.code).toBe(expected);
    }

    // Codes are group secrets: never in the logs (request lines included).
    const logged = JSON.stringify(ctx.logs.lines());
    for (const c of [code, disabled.code, exhausted.code, expired.code]) {
      expect(logged).not.toContain(c);
      expect(logged).not.toContain(c.toLowerCase());
    }
  });

  it('unknown code → 404 and the attempt limiter trips at 10 (429), even for a valid code', async () => {
    const { teacher, workspace } = await personal();
    const { code } = await createInviteLink({ workspace, createdBy: teacher });
    for (let i = 0; i < 10; i += 1) await http.get(preview('ZZZZZZZZ')).expect(404);
    const limited = await http.get(preview(code)).expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(limited.body.details.retryAfterS).toBeLessThanOrEqual(60);
  });

  it('AC-INV-08: requires_approval + max_uses 2: two students become PENDING_APPROVAL, the third gets 410 INVITE_LINK_EXHAUSTED, usesCount = 2, link EXHAUSTED', async () => {
    const { teacher, workspace } = await personal();
    const { link, code } = await createInviteLink({
      workspace,
      createdBy: teacher,
      requiresApproval: true,
      maxUses: 2,
    });
    const students = await Promise.all(
      [1, 2, 3].map((i) => createUser({ firstName: `S${i}`, birthDate: adultBirthDate() })),
    );
    for (const s of students.slice(0, 2)) {
      const res = await (await agent(s)).post(accept(code)).send({ mode: 'JOIN' }).expect(201);
      expect(res.body).toMatchObject({
        membershipStatus: 'PENDING_APPROVAL',
        role: 'STUDENT',
        workspace: { id: workspace.id, type: 'PERSONAL' },
      });
      expect((await membership(workspace, s))!.invitedByUserId).toBe(teacher.id);
    }
    const third = await (
      await agent(students[2]!)
    )
      .post(accept(code))
      .send({ mode: 'JOIN' })
      .expect(410);
    expect(third.body.code).toBe('INVITE_LINK_EXHAUSTED');
    expect(await membership(workspace, students[2]!)).toBeNull();

    const row = await db.inviteLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row).toMatchObject({ usesCount: 2, status: 'EXHAUSTED' });
    const used = await db.auditLog.findMany({ where: { action: 'invite_link.used' } });
    expect(used).toHaveLength(2);
    expect(used[0]!.after).toMatchObject({ linkId: link.id, membershipStatus: 'PENDING_APPROVAL' });
    expect(await db.auditLog.count({ where: { action: 'member.added' } })).toBe(2);
    // A pending student cannot use the workspace yet.
    const blocked = await (
      await agent(students[0]!)
    )
      .get(`/api/v1/workspaces/${workspace.id}`)
      .expect(403);
    expect(blocked.body.code).toBe('MEMBERSHIP_INACTIVE');
    // No guardian is involved for adults; no consent email.
    expect(ctx.email.findByTemplate('guardian.consent_requested')).toHaveLength(0);
  });

  it('REGISTER through a code creates an UNVERIFIED account (TERMS + PRIVACY, cookies) and sends auth.verify_email; an existing address → 409 EMAIL_TAKEN; JOIN by an existing member → 409 ALREADY_MEMBER without using the link', async () => {
    const { teacher, workspace } = await personal();
    const { link, code } = await createInviteLink({ workspace, createdBy: teacher });

    const res = await http.post(accept(code)).send(register()).expect(201);
    expect(res.body.membershipStatus).toBe('ACTIVE');
    expect(res.body.user).toMatchObject({ email: 'ahmed@example.com', emailVerifiedAt: null });
    expect(setCookies(res).some((c) => c.startsWith('nibras_access='))).toBe(true);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'ahmed@example.com' } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(
      (await db.consent.findMany({ where: { userId: user.id } })).map((c) => c.type).sort(),
    ).toEqual(['PRIVACY', 'TERMS']);
    const verify = ctx.email.findByTemplate('auth.verify_email', 'ahmed@example.com');
    expect(verify).toHaveLength(1);
    expect(extractFirstLink(verify[0]!.html, '/verify-email')).toContain('token=');
    expect(
      await db.verificationToken.count({ where: { userId: user.id, purpose: 'EMAIL_VERIFY' } }),
    ).toBe(1);
    // Unverified: only the verification flow is open (SP1 gates).
    const cookie = setCookies(res)
      .map((c) => c.split(';')[0])
      .join('; ');
    const gated = await as(http, cookie).get(`/api/v1/workspaces/${workspace.id}`).expect(403);
    expect(gated.body.code).toBe('EMAIL_NOT_VERIFIED');

    const taken = await http
      .post(accept(code))
      .send(register({ email: 'AHMED@example.com' }))
      .expect(409);
    expect(taken.body.code).toBe('EMAIL_TAKEN');

    const member = await createUser({ birthDate: adultBirthDate() });
    await db.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: 'STUDENT', status: 'ACTIVE' },
    });
    const dup = await (await agent(member)).post(accept(code)).send({ mode: 'JOIN' }).expect(409);
    expect(dup.body.code).toBe('ALREADY_MEMBER');
    expect((await db.inviteLink.findUniqueOrThrow({ where: { id: link.id } })).usesCount).toBe(1);

    // Mode rules: JOIN anonymous → 401; REGISTER signed in → 422 on mode.
    await http.post(accept(code)).send({ mode: 'JOIN' }).expect(401);
    const signedIn = await (
      await agent(member)
    )
      .post(accept(code))
      .send(register({ email: 'x@example.com' }))
      .expect(422);
    expect(signedIn.body.details.issues[0].path).toEqual(['mode']);
    await http
      .post(accept(code))
      .send(register({ email: undefined }))
      .expect(422);
  });

  it('personal workspace, adult, no approval → ACTIVE at once with the owner assignment and MembershipActivatedEvent', async () => {
    const { teacher, workspace } = await personal();
    const { code } = await createInviteLink({ workspace, createdBy: teacher });
    const student = await createUser();
    const events: MembershipActivatedEvent[] = [];
    const emitter = ctx.app.get(EventEmitter2);
    const listener = (e: MembershipActivatedEvent) => events.push(e);
    emitter.on(MEMBERSHIP_ACTIVATED, listener);
    try {
      const res = await (
        await agent(student)
      )
        .post(accept(code))
        .send({ mode: 'JOIN', birthDate: adultBirthDate() })
        .expect(201);
      expect(res.body.membershipStatus).toBe('ACTIVE');
      await new Promise((r) => setImmediate(r));
    } finally {
      emitter.off(MEMBERSHIP_ACTIVATED, listener);
    }
    expect(events).toEqual([expect.objectContaining({ workspaceId: workspace.id })]);
    expect((await membership(workspace, student))!.joinedAt).not.toBeNull();
    expect(
      await db.teacherStudentAssignment.count({
        where: { workspaceId: workspace.id, teacherUserId: teacher.id, studentUserId: student.id },
      }),
    ).toBe(1);
    // The missing birth date was recorded on the account.
    expect((await db.user.findUniqueOrThrow({ where: { id: student.id } })).birthDate).not.toBe(
      null,
    );
    await (await agent(student)).get(`/api/v1/workspaces/${workspace.id}`).expect(200);
    await expectMinorInvariant(db, workspace.id);
  });

  it('a minor without approval → PENDING_GUARDIAN_CONSENT and the consent email; birth date and guardian email rules of the invitation apply', async () => {
    const { teacher, workspace } = await personal();
    const { code } = await createInviteLink({ workspace, createdBy: teacher });

    const noDate = await http.post(accept(code)).send(register({ birthDate: undefined }));
    expect(noDate.status).toBe(422);
    expect(noDate.body.code).toBe('BIRTH_DATE_REQUIRED');
    const noGuardian = await http
      .post(accept(code))
      .send(register({ birthDate: minorBirthDate() }));
    expect(noGuardian.body.code).toBe('GUARDIAN_EMAIL_REQUIRED');
    const sameAddress = await http
      .post(accept(code))
      .send(register({ birthDate: minorBirthDate(), guardianEmail: 'Ahmed@example.com' }));
    expect(sameAddress.body.code).toBe('GUARDIAN_EMAIL_INVALID');
    expect(await db.user.count({ where: { email: 'ahmed@example.com' } })).toBe(0);

    const res = await http
      .post(accept(code))
      .send(register({ birthDate: minorBirthDate(), guardianEmail: 'parent@example.com' }))
      .expect(201);
    expect(res.body.membershipStatus).toBe('PENDING_GUARDIAN_CONSENT');
    const user = await db.user.findUniqueOrThrow({ where: { email: 'ahmed@example.com' } });
    const link = await db.guardianLink.findUniqueOrThrow({
      where: { studentUserId_workspaceId: { studentUserId: user.id, workspaceId: workspace.id } },
    });
    expect(link).toMatchObject({ status: 'PENDING', guardianEmail: 'parent@example.com' });
    expect(link.consentTokenHash).not.toBeNull();
    const mail = ctx.email.findByTemplate('guardian.consent_requested', 'parent@example.com');
    expect(mail).toHaveLength(1);
    expect(mail[0]!.html).toContain('Espace de Mohamed');
    expect(mail[0]!.html).toContain('Mohamed Ben Ali');
    await expectMinorInvariant(db, workspace.id);
  });

  it('Review Focus 2: a code with approval and a minor → PENDING_APPROVAL, no consent email before approval (D5); an adult account whose body birth date is a minor’s is a minor too', async () => {
    const { teacher, workspace } = await personal();
    const { code } = await createInviteLink({
      workspace,
      createdBy: teacher,
      requiresApproval: true,
    });
    const minor = await createUser({ birthDate: minorBirthDate() });
    // A known minor can never become an adult through the body.
    const noGuardian = await (
      await agent(minor)
    )
      .post(accept(code))
      .send({ mode: 'JOIN', birthDate: adultBirthDate() })
      .expect(422);
    expect(noGuardian.body.code).toBe('GUARDIAN_EMAIL_REQUIRED');
    const res = await (
      await agent(minor)
    )
      .post(accept(code))
      .send({ mode: 'JOIN', guardianEmail: 'parent@example.com' })
      .expect(201);
    expect(res.body.membershipStatus).toBe('PENDING_APPROVAL');
    expect(ctx.email.findByTemplate('guardian.consent_requested')).toHaveLength(0);
    // The guardian address is kept for the approval, without a consent link yet.
    const link = await db.guardianLink.findUniqueOrThrow({
      where: { studentUserId_workspaceId: { studentUserId: minor.id, workspaceId: workspace.id } },
    });
    expect(link).toMatchObject({
      status: 'PENDING',
      guardianEmail: 'parent@example.com',
      consentTokenHash: null,
      consentExpiresAt: null,
    });

    const adult = await createUser({ birthDate: adultBirthDate() });
    const res2 = await (
      await agent(adult)
    )
      .post(accept(code))
      .send({ mode: 'JOIN', birthDate: minorBirthDate(), guardianEmail: 'p2@example.com' })
      .expect(201);
    expect(res2.body.membershipStatus).toBe('PENDING_APPROVAL');
    await expectMinorInvariant(db, workspace.id);
  });

  it('organisation: the student is assigned to the link teacher; a minor without approval is PENDING_GUARDIAN_CONSENT and the email names that teacher', async () => {
    const owner = await verifiedUser({ totpSecret: S, firstName: 'Owner' });
    const teacher = await verifiedUser({ firstName: 'Leila', lastName: 'Haddad' });
    const { workspace } = await createOrganization({
      owner,
      teachers: [teacher],
      name: 'Académie Nour',
    });
    const { code } = await createInviteLink({
      workspace,
      createdBy: owner,
      teacherUserId: teacher.id,
    });
    const student = await createUser({ birthDate: minorBirthDate() });
    const res = await (
      await agent(student)
    )
      .post(accept(code))
      .send({ mode: 'JOIN', guardianEmail: 'parent@example.com' })
      .expect(201);
    expect(res.body.membershipStatus).toBe('PENDING_GUARDIAN_CONSENT');
    expect(
      await db.teacherStudentAssignment.count({
        where: { workspaceId: workspace.id, teacherUserId: teacher.id, studentUserId: student.id },
      }),
    ).toBe(1);
    const mail = ctx.email.findByTemplate('guardian.consent_requested', 'parent@example.com');
    expect(mail[0]!.html).toContain('Leila Haddad');
    expect(mail[0]!.html).toContain('Académie Nour');
    await expectMinorInvariant(db, workspace.id);
  });

  it('Review Focus 3: two concurrent accepts on the last use → one 201, one 410 INVITE_LINK_EXHAUSTED, usesCount = maxUses', async () => {
    const { teacher, workspace } = await personal();
    const { link, code } = await createInviteLink({
      workspace,
      createdBy: teacher,
      maxUses: 3,
      usesCount: 2,
    });
    const [s1, s2] = await Promise.all([
      createUser({ birthDate: adultBirthDate() }),
      createUser({ birthDate: adultBirthDate() }),
    ]);
    const [a1, a2] = await Promise.all([agent(s1), agent(s2)]);
    const results = await Promise.all([
      a1.post(accept(code)).send({ mode: 'JOIN' }),
      a2.post(accept(code)).send({ mode: 'JOIN' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 410]);
    expect(results.find((r) => r.status === 410)!.body.code).toBe('INVITE_LINK_EXHAUSTED');
    expect(await db.inviteLink.findUniqueOrThrow({ where: { id: link.id } })).toMatchObject({
      usesCount: 3,
      status: 'EXHAUSTED',
    });
    expect(
      await db.membership.count({ where: { workspaceId: workspace.id, role: 'STUDENT' } }),
    ).toBe(1);
  });

  it('a SUSPENDED or DELETING workspace refuses the join with 423 WORKSPACE_SUSPENDED; the use is not counted', async () => {
    for (const status of ['SUSPENDED', 'DELETING'] as const) {
      await ctx.reset();
      const { teacher, workspace } = await personal({ status });
      const { link, code } = await createInviteLink({ workspace, createdBy: teacher });
      const student = await createUser({ birthDate: adultBirthDate() });
      const res = await (await agent(student)).post(accept(code)).send({ mode: 'JOIN' });
      expect(res.status, status).toBe(423);
      expect(res.body.code, status).toBe('WORKSPACE_SUSPENDED');
      const reg = await http.post(accept(code)).send(register());
      expect(reg.status, status).toBe(423);
      expect(await db.user.count({ where: { email: 'ahmed@example.com' } }), status).toBe(0);
      expect(await membership(workspace, student), status).toBeNull();
      expect((await db.inviteLink.findUniqueOrThrow({ where: { id: link.id } })).usesCount).toBe(0);
    }
  });

  it('the code of workspace A only ever joins workspace A', async () => {
    const a = await personal();
    const tb = await verifiedUser();
    const b = await createPersonalWorkspace(tb);
    const { code } = await createInviteLink({ workspace: a.workspace, createdBy: a.teacher });
    await createInviteLink({ workspace: b, createdBy: tb });
    const student = await createUser({ birthDate: adultBirthDate() });
    const res = await (await agent(student)).post(accept(code)).send({ mode: 'JOIN' }).expect(201);
    expect(res.body.workspace.id).toBe(a.workspace.id);
    expect(await membership(b, student)).toBeNull();
  });
  it('a REJECTED student cannot re-join by group code: 409 ALREADY_MEMBER, the link is not used, the row stays REJECTED', async () => {
    const { teacher, workspace } = await personal();
    const { link, code } = await createInviteLink({ workspace, createdBy: teacher });
    const student = await createUser({ birthDate: adultBirthDate() });
    const m = await db.membership.create({
      data: {
        workspaceId: workspace.id,
        userId: student.id,
        role: 'STUDENT',
        status: 'REJECTED',
        removedAt: new Date(),
        removalReason: 'REJECTED',
      },
    });
    const res = await (await agent(student)).post(accept(code)).send({ mode: 'JOIN' }).expect(409);
    expect(res.body.code).toBe('ALREADY_MEMBER');
    expect((await db.inviteLink.findUniqueOrThrow({ where: { id: link.id } })).usesCount).toBe(0);
    expect(await db.membership.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({
      status: 'REJECTED',
      removalReason: 'REJECTED',
    });
  });
});
