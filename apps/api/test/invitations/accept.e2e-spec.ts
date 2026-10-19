import { EventEmitter2 } from '@nestjs/event-emitter';
import { GUARDIAN_CONSENT_TTL_MS, hashOpaqueToken } from '@nibras/contracts';
import { withTenantTx, type PrismaClient, type User, type Workspace } from '@nibras/db';
import { extractFirstLink } from '@nibras/providers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GuardianRequestService } from '../../src/guardian/guardian-request.service';
import { INVITATION_ACCEPTED, type InvitationAcceptedEvent } from '../../src/members/events';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs, setCookies } from '../helpers/auth';
import {
  adultBirthDate,
  createGuardianLink,
  createInvitation,
  createOrganization,
  createPersonalWorkspace,
  createStudent,
  createUser,
  minorBirthDate,
} from '../helpers/factories';
import { expectMinorInvariant } from '../helpers/invariants';

const S = 'JBSWY3DPEHPK3PXP';
const MIN = 60_000;
const DAY = 24 * 3600 * 1000;
const PASSWORD = 'un mot de passe assez long';

/** A teacher who passes `@RequireVerifiedTeacher()`. */
const verifiedUser = (o: Parameters<typeof createUser>[0] = {}) =>
  createUser({ phoneVerified: true, consents: ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT'], ...o });

const register = (patch: Record<string, unknown> = {}) => ({
  mode: 'REGISTER',
  firstName: 'Ahmed',
  lastName: 'Trabelsi',
  password: PASSWORD,
  locale: 'fr',
  timezone: 'Africa/Tunis',
  acceptTerms: true,
  acceptPrivacy: true,
  ...patch,
});

describe('public invitation acceptance (AC-INV-02, 03, 09, 13; AC-WS-08)', () => {
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
  const preview = (token: string) => `/api/v1/invitations/${token}`;
  const accept = (token: string) => `/api/v1/invitations/${token}/accept`;

  /** Mohamed Ben Ali (verified) and his PERSONAL workspace. */
  async function personal(): Promise<{ teacher: User; workspace: Workspace }> {
    const teacher = await verifiedUser({ firstName: 'Mohamed', lastName: 'Ben Ali' });
    const workspace = await createPersonalWorkspace(teacher, { name: 'Espace de Mohamed' });
    return { teacher, workspace };
  }

  /** Every acceptance-related event emitted while `fn` runs. */
  async function collectAccepted(fn: () => Promise<void>): Promise<InvitationAcceptedEvent[]> {
    const events: InvitationAcceptedEvent[] = [];
    const listener = (e: InvitationAcceptedEvent) => events.push(e);
    const emitter = ctx.app.get(EventEmitter2);
    emitter.on(INVITATION_ACCEPTED, listener);
    try {
      await fn();
      // Fire-and-forget emission: let the listener run.
      await new Promise((r) => setImmediate(r));
    } finally {
      emitter.off(INVITATION_ACCEPTED, listener);
    }
    return events;
  }

  it('preview: anonymous → ANONYMOUS + emailMasked; the invited user signed in → MATCH; another user → MISMATCH; unknown token → 410 TOKEN_INVALID and counts an attempt', async () => {
    const { teacher, workspace } = await personal();
    const { token, invitation } = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: 'ahmed@example.com',
      message: 'Bienvenue',
    });

    const anon = await http.get(preview(token)).expect(200);
    expect(anon.body).toEqual({
      workspace: { id: workspace.id, name: 'Espace de Mohamed', type: 'PERSONAL' },
      inviter: { firstName: 'Mohamed', lastName: 'Ben Ali' },
      role: 'STUDENT',
      emailMasked: 'a***@example.com',
      accountExists: false,
      viewer: 'ANONYMOUS',
      requiresBirthDate: true,
      guardianEmailPrefilled: false,
      expiresAt: invitation.expiresAt.toISOString(),
      message: 'Bienvenue',
    });
    expect(JSON.stringify(anon.body)).not.toContain('ahmed@');

    const ahmed = await createUser({ email: 'ahmed@example.com', birthDate: adultBirthDate() });
    const match = await (await agent(ahmed)).get(preview(token)).expect(200);
    expect(match.body).toMatchObject({
      viewer: 'MATCH',
      accountExists: true,
      requiresBirthDate: false,
    });
    const sarah = await createUser({ email: 'sarah@example.com' });
    const other = await (await agent(sarah)).get(preview(token)).expect(200);
    expect(other.body.viewer).toBe('MISMATCH');

    // Unknown and malformed tokens are indistinguishable.
    const unknown = 'A'.repeat(43);
    await http
      .get(preview(unknown))
      .expect(410)
      .expect(({ body }) => expect(body.code).toBe('TOKEN_INVALID'));
    await http
      .get(preview('not-a-token'))
      .expect(410)
      .expect(({ body }) => expect(body.code).toBe('TOKEN_INVALID'));
    await http
      .post(accept(unknown))
      .send({ mode: 'JOIN' })
      .expect(410)
      .expect(({ body }) => expect(body.code).toBe('TOKEN_INVALID'));
    // 3 misses counted; 7 more reach the limit, then even a valid token is refused.
    for (let i = 0; i < 7; i += 1) await http.get(preview(unknown)).expect(410);
    const limited = await http.get(preview(token)).expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(limited.body.details.retryAfterS).toBeLessThanOrEqual(60);

    // The raw token never reaches the logs (request lines included).
    expect(JSON.stringify(ctx.logs.lines())).not.toContain(token);
    expect(JSON.stringify(ctx.logs.lines())).not.toContain(unknown);
  });

  it('preview and accept: expired → 410 INVITATION_EXPIRED, revoked → 410 INVITATION_REVOKED, accepted → 410 INVITATION_ALREADY_ACCEPTED', async () => {
    const { teacher, workspace } = await personal();
    const expired = await createInvitation({
      workspace,
      invitedBy: teacher,
      expiresAt: new Date(Date.now() - MIN),
    });
    const revoked = await createInvitation({ workspace, invitedBy: teacher, status: 'REVOKED' });
    const accepted = await createInvitation({ workspace, invitedBy: teacher, status: 'ACCEPTED' });
    for (const [inv, code] of [
      [expired, 'INVITATION_EXPIRED'],
      [revoked, 'INVITATION_REVOKED'],
      [accepted, 'INVITATION_ALREADY_ACCEPTED'],
    ] as const) {
      await http
        .get(preview(inv.token))
        .expect(410)
        .expect(({ body }) => expect(body.code).toBe(code));
      await http
        .post(accept(inv.token))
        .send(register({ birthDate: adultBirthDate() }))
        .expect(410)
        .expect(({ body }) => expect(body.code).toBe(code));
    }
    expect(await db.user.count({ where: { firstName: 'Ahmed' } })).toBe(0);
  });

  it('AC-INV-03: existing account joins → Membership STUDENT ACTIVE, assignment in a PERSONAL workspace, invitation ACCEPTED, inviter emailed invitation.accepted, event emitted', async () => {
    const { teacher, workspace } = await personal();
    const ahmed = await createUser({
      email: 'ahmed@example.com',
      firstName: 'Ahmed',
      lastName: 'Trabelsi',
      birthDate: adultBirthDate(),
    });
    const { token, invitation } = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: 'ahmed@example.com',
    });
    const a = await agent(ahmed);
    let res!: Awaited<ReturnType<ReturnType<typeof a.post>['send']>>;
    const events = await collectAccepted(async () => {
      res = await a.post(accept(token)).send({ mode: 'JOIN' }).expect(201);
    });
    expect(res.body).toMatchObject({
      user: { id: ahmed.id, email: 'ahmed@example.com' },
      workspace: { id: workspace.id, name: workspace.name, type: 'PERSONAL' },
      membershipStatus: 'ACTIVE',
      role: 'STUDENT',
    });
    expect(setCookies(res)).toHaveLength(0);

    const membership = await db.membership.findFirstOrThrow({
      where: { workspaceId: workspace.id, userId: ahmed.id },
    });
    expect(membership).toMatchObject({
      role: 'STUDENT',
      status: 'ACTIVE',
      invitedByUserId: teacher.id,
    });
    expect(membership.joinedAt).toBeInstanceOf(Date);
    expect(
      await db.teacherStudentAssignment.count({
        where: { workspaceId: workspace.id, teacherUserId: teacher.id, studentUserId: ahmed.id },
      }),
    ).toBe(1);
    const row = await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(row).toMatchObject({ status: 'ACCEPTED', acceptedByUserId: ahmed.id });
    expect(row.acceptedAt).toBeInstanceOf(Date);

    const [mail] = ctx.email.findByTemplate('invitation.accepted', teacher.email);
    expect(mail!.params).toMatchObject({
      firstName: 'Mohamed',
      memberName: 'Ahmed Trabelsi',
      workspaceName: workspace.name,
    });
    expect(events).toEqual([
      expect.objectContaining({
        workspaceId: workspace.id,
        invitationId: invitation.id,
        userId: ahmed.id,
        role: 'STUDENT',
      }),
    ]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'invitation.accepted' } });
    expect(audit).toMatchObject({
      entityType: 'Invitation',
      entityId: invitation.id,
      workspaceId: workspace.id,
      actorUserId: ahmed.id,
    });
    expect(audit.after).toMatchObject({ role: 'STUDENT', membershipStatus: 'ACTIVE' });
    expect(await db.auditLog.count({ where: { action: 'member.added' } })).toBe(1);
    // No verification email: the account already exists.
    expect(ctx.email.findByTemplate('auth.verify_email')).toHaveLength(0);
    await expectMinorInvariant(db, workspace.id);
  });

  it('organisation: the student is assigned to the invitation teacher, or to a teaching inviter; no assignment from a non-teaching admin', async () => {
    const owner = await verifiedUser({ totpSecret: S });
    const admin = await verifiedUser({ totpSecret: S });
    const teacher = await verifiedUser({ firstName: 'Karim' });
    const { workspace } = await createOrganization({ owner, admins: [admin], teachers: [teacher] });
    const s1 = await createUser({ birthDate: adultBirthDate() });
    const s2 = await createUser({ birthDate: adultBirthDate() });
    const s3 = await createUser({ birthDate: adultBirthDate() });
    const i1 = await createInvitation({
      workspace,
      invitedBy: admin,
      email: s1.email,
      teacherUserId: teacher.id,
    });
    const i2 = await createInvitation({ workspace, invitedBy: teacher, email: s2.email });
    const i3 = await createInvitation({ workspace, invitedBy: admin, email: s3.email });
    await (await agent(s1)).post(accept(i1.token)).send({ mode: 'JOIN' }).expect(201);
    await (await agent(s2)).post(accept(i2.token)).send({ mode: 'JOIN' }).expect(201);
    await (await agent(s3)).post(accept(i3.token)).send({ mode: 'JOIN' }).expect(201);
    const rows = await db.teacherStudentAssignment.findMany({
      where: { workspaceId: workspace.id },
      select: { teacherUserId: true, studentUserId: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { teacherUserId: teacher.id, studentUserId: s1.id },
        { teacherUserId: teacher.id, studentUserId: s2.id },
      ]),
    );
  });

  it('AC-INV-02: signed in as sarah → 403 INVITATION_EMAIL_MISMATCH with details.emailMasked = a***@example.com; nothing changes', async () => {
    const { teacher, workspace } = await personal();
    const { token, invitation } = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: 'ahmed@example.com',
    });
    const sarah = await createUser({ email: 'sarah@example.com', birthDate: adultBirthDate() });
    const s = await agent(sarah);
    for (const body of [{ mode: 'JOIN' }, register({ birthDate: adultBirthDate() })]) {
      const res = await s.post(accept(token)).send(body).expect(403);
      expect(res.body.code).toBe('INVITATION_EMAIL_MISMATCH');
      expect(res.body.details).toEqual({ emailMasked: 'a***@example.com' });
    }
    expect(await db.membership.count({ where: { workspaceId: workspace.id } })).toBe(1);
    expect((await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe(
      'PENDING',
    );
    expect(await db.user.count({ where: { email: 'ahmed@example.com' } })).toBe(0);
  });

  it('JOIN anonymous → 401; REGISTER while signed in → 422 on mode; REGISTER with an existing account → 409 EMAIL_TAKEN', async () => {
    const { teacher, workspace } = await personal();
    const { token } = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: 'ahmed@example.com',
    });
    await http
      .post(accept(token))
      .send({ mode: 'JOIN', birthDate: adultBirthDate() })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('UNAUTHENTICATED'));
    const ahmed = await createUser({ email: 'ahmed@example.com', birthDate: adultBirthDate() });
    const res = await (
      await agent(ahmed)
    )
      .post(accept(token))
      .send(register({ birthDate: adultBirthDate() }))
      .expect(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.issues[0].path).toEqual(['mode']);
    await http
      .post(accept(token))
      .send(register({ birthDate: adultBirthDate() }))
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('EMAIL_TAKEN'));
    expect(await db.membership.count({ where: { workspaceId: workspace.id } })).toBe(1);
  });

  it('REGISTER (adult): account created with emailVerifiedAt set, TERMS+PRIVACY consents, cookies set, 201 user + membershipStatus ACTIVE; a second accept → 410 INVITATION_ALREADY_ACCEPTED', async () => {
    const { teacher, workspace } = await personal();
    const { token } = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: 'ahmed@example.com',
    });
    const birthDate = adultBirthDate();
    const res = await http.post(accept(token)).send(register({ birthDate })).expect(201);
    expect(res.body).toMatchObject({
      user: {
        email: 'ahmed@example.com',
        firstName: 'Ahmed',
        birthDate,
        twoFactor: { enabled: false, required: false },
        pendingConsents: [],
      },
      membershipStatus: 'ACTIVE',
      role: 'STUDENT',
    });
    expect(res.body.user.emailVerifiedAt).not.toBeNull();
    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith('nibras_access='))).toBe(true);

    const user = await db.user.findUniqueOrThrow({ where: { email: 'ahmed@example.com' } });
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(user.birthDate?.toISOString().slice(0, 10)).toBe(birthDate);
    const consents = await db.consent.findMany({ where: { userId: user.id } });
    expect(consents.map((c) => c.type).sort()).toEqual(['PRIVACY', 'TERMS']);
    expect(await db.verificationToken.count({ where: { userId: user.id } })).toBe(0);
    expect(ctx.email.findByTemplate('auth.verify_email')).toHaveLength(0);
    // Students get no PERSONAL workspace either.
    expect(await db.workspace.count({ where: { ownerUserId: user.id } })).toBe(0);

    // The session works right away (the gates pass: verified email, consents given).
    const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
    await as(http, cookie).get('/api/v1/me').expect(200);
    await as(http, cookie).get(`/api/v1/workspaces/${workspace.id}`).expect(200);

    await http
      .post(accept(token))
      .send(register({ birthDate }))
      .expect(410)
      .expect(({ body }) => expect(body.code).toBe('INVITATION_ALREADY_ACCEPTED'));
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'invitation.accepted' } });
    expect(audit.actorUserId).toBe(user.id);
    await expectMinorInvariant(db, workspace.id);
  });

  it('AC-INV-09: REGISTER with a minor birth date and a guardian email → PENDING_GUARDIAN_CONSENT, GuardianLink PENDING (14 d), guardian.consent_requested email naming the workspace and the teacher, then every /workspaces/{wid}/... call → 403 GUARDIAN_CONSENT_REQUIRED', async () => {
    const { teacher, workspace } = await personal();
    const { token, invitation } = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: 'yassine@example.com',
    });
    const events = await collectAccepted(async () => {
      const res = await http
        .post(accept(token))
        .send(
          register({
            firstName: 'Yassine',
            lastName: 'Gharbi',
            birthDate: minorBirthDate(),
            guardianEmail: 'Parent@Example.com',
          }),
        )
        .expect(201);
      expect(res.body.membershipStatus).toBe('PENDING_GUARDIAN_CONSENT');
    });
    expect(events).toHaveLength(1);
    const student = await db.user.findUniqueOrThrow({ where: { email: 'yassine@example.com' } });
    const membership = await db.membership.findFirstOrThrow({
      where: { workspaceId: workspace.id, userId: student.id },
    });
    expect(membership.status).toBe('PENDING_GUARDIAN_CONSENT');
    expect(membership.joinedAt).toBeNull();

    const link = await db.guardianLink.findUniqueOrThrow({
      where: {
        studentUserId_workspaceId: { studentUserId: student.id, workspaceId: workspace.id },
      },
    });
    expect(link).toMatchObject({
      status: 'PENDING',
      guardianEmail: 'parent@example.com',
      consentResentCount: 0,
    });
    const ttl = +link.consentExpiresAt! - Date.now();
    expect(ttl).toBeGreaterThan(GUARDIAN_CONSENT_TTL_MS - MIN);
    expect(ttl).toBeLessThanOrEqual(GUARDIAN_CONSENT_TTL_MS);

    const [mail] = ctx.email.findByTemplate('guardian.consent_requested', 'parent@example.com');
    expect(mail!.locale).toBe(workspace.defaultLocale);
    expect(mail!.params).toMatchObject({
      studentName: 'Yassine Gharbi',
      workspaceName: workspace.name,
      teacherName: 'Mohamed Ben Ali',
    });
    const consentLink = extractFirstLink(mail!.html, '/guardian-consent/');
    expect(consentLink).toMatch(/\/fr\/guardian-consent\/[A-Za-z0-9_-]{43}$/);
    const raw = consentLink!.split('/').pop()!;
    expect(link.consentTokenHash).toBe(hashOpaqueToken(raw));

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'guardian.consent_requested' },
    });
    expect(audit).toMatchObject({
      entityType: 'GuardianLink',
      entityId: link.id,
      workspaceId: workspace.id,
    });
    expect(audit.after).toMatchObject({ guardianEmailMasked: 'p***@example.com' });
    expect(JSON.stringify(audit.after)).not.toContain('parent@example.com');
    const accepted = await db.auditLog.findFirstOrThrow({
      where: { action: 'invitation.accepted', entityId: invitation.id },
    });
    expect(accepted.after).toMatchObject({ membershipStatus: 'PENDING_GUARDIAN_CONSENT' });
    expect(JSON.stringify(ctx.logs.lines())).not.toContain(raw);

    const s = await agent(student);
    const blocked = await s.get(`/api/v1/workspaces/${workspace.id}`).expect(403);
    expect(blocked.body).toMatchObject({
      code: 'GUARDIAN_CONSENT_REQUIRED',
      details: { status: 'PENDING_GUARDIAN_CONSENT' },
    });
    await s
      .get(`/api/v1/workspaces/${workspace.id}/members`)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('GUARDIAN_CONSENT_REQUIRED'));
    await expectMinorInvariant(db, workspace.id);
  });

  it('a minor invitation with the guardian email and birth date prefilled: JOIN needs no body field', async () => {
    const { teacher, workspace } = await personal();
    const kid = await createUser({ email: 'kid@example.com' });
    const { token } = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: 'kid@example.com',
      birthDate: minorBirthDate(),
      guardianEmail: 'mum@example.com',
    });
    const p = await (await agent(kid)).get(preview(token)).expect(200);
    expect(p.body).toMatchObject({ requiresBirthDate: false, guardianEmailPrefilled: true });
    const res = await (await agent(kid)).post(accept(token)).send({ mode: 'JOIN' }).expect(201);
    expect(res.body.membershipStatus).toBe('PENDING_GUARDIAN_CONSENT');
    // The account had no birth date: the invitation's is recorded.
    const stored = await db.user.findUniqueOrThrow({ where: { id: kid.id } });
    expect(stored.birthDate?.toISOString().slice(0, 10)).toBe(minorBirthDate());
    expect(ctx.email.findByTemplate('guardian.consent_requested', 'mum@example.com')).toHaveLength(
      1,
    );
    await expectMinorInvariant(db, workspace.id);
  });

  it('minor without guardian email → 422 GUARDIAN_EMAIL_REQUIRED; guardian email equal to the student → 422 GUARDIAN_EMAIL_INVALID; student without birth date anywhere → 422 BIRTH_DATE_REQUIRED', async () => {
    const { teacher, workspace } = await personal();
    const { token } = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: 'yassine@example.com',
    });
    const cases: [Record<string, unknown>, string][] = [
      [register({ birthDate: minorBirthDate() }), 'GUARDIAN_EMAIL_REQUIRED'],
      [
        register({ birthDate: minorBirthDate(), guardianEmail: 'Yassine@example.com' }),
        'GUARDIAN_EMAIL_INVALID',
      ],
      [register(), 'BIRTH_DATE_REQUIRED'],
    ];
    for (const [body, code] of cases) {
      await http
        .post(accept(token))
        .send(body)
        .expect(422)
        .expect(({ body: b }) => expect(b.code).toBe(code));
    }
    expect(await db.user.count({ where: { email: 'yassine@example.com' } })).toBe(0);
    expect(await db.guardianLink.count()).toBe(0);
    expect(ctx.email.sent).toHaveLength(0);
  });

  it('AC-INV-13: a minor already consented in workspace A accepts B → a second GuardianLink (B) PENDING, B-named email, A consent and A link untouched', async () => {
    const a = await personal();
    const teacherB = await verifiedUser({ firstName: 'Leila', lastName: 'Haddad' });
    const workspaceB = await createPersonalWorkspace(teacherB, { name: 'Espace de Leila' });
    const { user: kid, guardianLink: linkA } = await createStudent({
      workspace: a.workspace,
      minor: true,
      guardianEmail: 'parent@example.com',
      user: { email: 'kid@example.com', firstName: 'Kid', lastName: 'Ali' },
    });
    const { token } = await createInvitation({
      workspace: workspaceB,
      invitedBy: teacherB,
      email: 'kid@example.com',
      guardianEmail: 'parent@example.com',
    });
    const res = await (await agent(kid)).post(accept(token)).send({ mode: 'JOIN' }).expect(201);
    expect(res.body.membershipStatus).toBe('PENDING_GUARDIAN_CONSENT');

    const linkB = await db.guardianLink.findUniqueOrThrow({
      where: { studentUserId_workspaceId: { studentUserId: kid.id, workspaceId: workspaceB.id } },
    });
    expect(linkB.status).toBe('PENDING');
    expect(linkB.id).not.toBe(linkA!.id);
    const mails = ctx.email.findByTemplate('guardian.consent_requested', 'parent@example.com');
    expect(mails).toHaveLength(1);
    expect(mails[0]!.params).toMatchObject({
      workspaceName: 'Espace de Leila',
      teacherName: 'Leila Haddad',
    });

    const afterA = await db.guardianLink.findUniqueOrThrow({ where: { id: linkA!.id } });
    expect(afterA).toEqual(linkA);
    const consentA = await db.consent.findFirstOrThrow({
      where: { userId: kid.id, workspaceId: a.workspace.id, type: 'GUARDIAN_PARENTAL' },
    });
    expect(consentA.revokedAt).toBeNull();
    expect(
      (
        await db.membership.findFirstOrThrow({
          where: { workspaceId: a.workspace.id, userId: kid.id },
        })
      ).status,
    ).toBe('ACTIVE');
    await expectMinorInvariant(db, a.workspace.id);
    await expectMinorInvariant(db, workspaceB.id);
  });

  it('Review Focus 2: JOIN by an adult account whose invitation carries a minor birthDate stays non-ACTIVE (the invitation birthDate wins only when the account has none; a conflicting minor body birthDate makes him a minor) — expectMinorInvariant', async () => {
    const { teacher, workspace } = await personal();

    // (a) Account without a birth date (SP1): the invitation's minor date applies.
    const noDate = await createUser();
    const ia = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: noDate.email,
      birthDate: minorBirthDate(),
      guardianEmail: 'g1@example.com',
    });
    const ra = await (
      await agent(noDate)
    )
      .post(accept(ia.token))
      .send({ mode: 'JOIN' })
      .expect(201);
    expect(ra.body.membershipStatus).toBe('PENDING_GUARDIAN_CONSENT');

    // (b) Adult account, adult invitation, minor birth date in the body: a minor.
    const adult = await createUser({ birthDate: adultBirthDate() });
    const ib = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: adult.email,
      birthDate: adultBirthDate(),
    });
    await (
      await agent(adult)
    )
      .post(accept(ib.token))
      .send({ mode: 'JOIN', birthDate: minorBirthDate() })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('GUARDIAN_EMAIL_REQUIRED'));
    const rb = await (
      await agent(adult)
    )
      .post(accept(ib.token))
      .send({ mode: 'JOIN', birthDate: minorBirthDate(), guardianEmail: 'g2@example.com' })
      .expect(201);
    expect(rb.body.membershipStatus).toBe('PENDING_GUARDIAN_CONSENT');

    // (c) A minor account cannot make himself an adult with the body.
    const minor = await createUser({ birthDate: minorBirthDate() });
    const ic = await createInvitation({ workspace, invitedBy: teacher, email: minor.email });
    await (
      await agent(minor)
    )
      .post(accept(ic.token))
      .send({ mode: 'JOIN', birthDate: adultBirthDate() })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('GUARDIAN_EMAIL_REQUIRED'));

    // (d) Adult account with a stored date: a minor date on the invitation does not override it.
    const grown = await createUser({ birthDate: adultBirthDate() });
    const id = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: grown.email,
      birthDate: minorBirthDate(),
    });
    const rd = await (await agent(grown)).post(accept(id.token)).send({ mode: 'JOIN' }).expect(201);
    expect(rd.body.membershipStatus).toBe('ACTIVE');

    const statuses = await db.membership.findMany({
      where: { workspaceId: workspace.id, role: 'STUDENT' },
      select: { userId: true, status: true },
    });
    expect(statuses).toEqual(
      expect.arrayContaining([
        { userId: noDate.id, status: 'PENDING_GUARDIAN_CONSENT' },
        { userId: adult.id, status: 'PENDING_GUARDIAN_CONSENT' },
        { userId: grown.id, status: 'ACTIVE' },
      ]),
    );
    await expectMinorInvariant(db, workspace.id);
  });

  it('a removed minor whose guardian consent for this workspace is still active comes back ACTIVE without a new consent cycle', async () => {
    const { teacher, workspace } = await personal();
    const { user: kid } = await createStudent({
      workspace,
      minor: true,
      status: 'REMOVED',
      guardianStatus: 'ACTIVE',
      guardianEmail: 'parent@example.com',
    });
    const { token } = await createInvitation({ workspace, invitedBy: teacher, email: kid.email });
    const res = await (
      await agent(kid)
    )
      .post(accept(token))
      .send({ mode: 'JOIN', guardianEmail: 'parent@example.com' })
      .expect(201);
    expect(res.body.membershipStatus).toBe('ACTIVE');
    expect(ctx.email.findByTemplate('guardian.consent_requested')).toHaveLength(0);
    await expectMinorInvariant(db, workspace.id);
  });

  it('a refused guardian link of this workspace is re-armed (PENDING, new token, new expiry) on a new acceptance', async () => {
    const { teacher, workspace } = await personal();
    const kid = await createUser({ birthDate: minorBirthDate() });
    const { link } = await createGuardianLink({
      workspace,
      student: kid,
      status: 'REFUSED',
      guardianEmail: 'old@example.com',
    });
    const { token } = await createInvitation({ workspace, invitedBy: teacher, email: kid.email });
    await (
      await agent(kid)
    )
      .post(accept(token))
      .send({ mode: 'JOIN', guardianEmail: 'new@example.com' })
      .expect(201);
    const row = await db.guardianLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row).toMatchObject({ status: 'PENDING', guardianEmail: 'new@example.com' });
    expect(row.consentTokenHash).not.toBeNull();
    expect(row.decidedAt).toBeNull();
    expect(await db.guardianLink.count()).toBe(1);
  });

  it('AC-WS-08: a teacher accepting an organisation invitation by REGISTER has no PERSONAL workspace; /me/workspaces lists only the organisation', async () => {
    const owner = await verifiedUser({ totpSecret: S });
    const { workspace } = await createOrganization({ owner, name: 'Académie Nour' });
    const { token } = await createInvitation({
      workspace,
      invitedBy: owner,
      email: 'karim@example.com',
      role: 'TEACHER',
    });
    const p = await http.get(preview(token)).expect(200);
    expect(p.body).toMatchObject({ role: 'TEACHER', requiresBirthDate: false });
    const res = await http
      .post(accept(token))
      .send(register({ firstName: 'Karim' }))
      .expect(201);
    expect(res.body).toMatchObject({ membershipStatus: 'ACTIVE', role: 'TEACHER' });
    const karim = await db.user.findUniqueOrThrow({ where: { email: 'karim@example.com' } });
    expect(await db.workspace.count({ where: { ownerUserId: karim.id } })).toBe(0);
    expect(await db.workspace.count({ where: { type: 'PERSONAL' } })).toBe(0);
    const cookie = setCookies(res)
      .map((c) => c.split(';')[0])
      .join('; ');
    const { body } = await as(http, cookie).get('/api/v1/me/workspaces').expect(200);
    expect(body).toHaveLength(1);
    expect(body[0].workspace).toMatchObject({ id: workspace.id, type: 'ORGANIZATION' });
    expect(body[0].role).toBe('TEACHER');
  });

  it('an ADMIN invitation accepted by REGISTER: the answer says 2FA is now required', async () => {
    const owner = await verifiedUser({ totpSecret: S });
    const { workspace } = await createOrganization({ owner });
    const { token } = await createInvitation({
      workspace,
      invitedBy: owner,
      email: 'admin2@example.com',
      role: 'ADMIN',
    });
    const res = await http.post(accept(token)).send(register()).expect(201);
    expect(res.body).toMatchObject({
      role: 'ADMIN',
      membershipStatus: 'ACTIVE',
      user: { twoFactor: { enabled: false, required: true } },
    });
  });

  it('Review Focus 3: two concurrent accepts of one invitation → one 201, one 410 INVITATION_ALREADY_ACCEPTED, one membership', async () => {
    const { teacher, workspace } = await personal();
    const ahmed = await createUser({ email: 'ahmed@example.com', birthDate: adultBirthDate() });
    const { token } = await createInvitation({ workspace, invitedBy: teacher, email: ahmed.email });
    const a = await agent(ahmed);
    const results = await Promise.all([
      a.post(accept(token)).send({ mode: 'JOIN' }),
      a.post(accept(token)).send({ mode: 'JOIN' }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 410]);
    expect(results.find((r) => r.status === 410)!.body.code).toBe('INVITATION_ALREADY_ACCEPTED');
    expect(
      await db.membership.count({ where: { workspaceId: workspace.id, userId: ahmed.id } }),
    ).toBe(1);

    // Two concurrent registrations: one account.
    const second = await createInvitation({
      workspace,
      invitedBy: teacher,
      email: 'nour@example.com',
    });
    const regs = await Promise.all([
      http.post(accept(second.token)).send(register({ birthDate: adultBirthDate() })),
      http.post(accept(second.token)).send(register({ birthDate: adultBirthDate() })),
    ]);
    expect(regs.map((r) => r.status).sort()).toEqual([201, 410]);
    expect(await db.user.count({ where: { email: 'nour@example.com' } })).toBe(1);
    expect(ctx.email.findByTemplate('invitation.accepted')).toHaveLength(2);
  });

  it("Review Focus 1: the token of A is unusable after a resend (410 TOKEN_INVALID), and preview/accept never reach another workspace's row", async () => {
    const a = await personal();
    const teacherB = await verifiedUser({ firstName: 'Leila' });
    const workspaceB = await createPersonalWorkspace(teacherB);
    const ahmed = await createUser({ email: 'ahmed@example.com', birthDate: adultBirthDate() });
    const first = await createInvitation({
      workspace: a.workspace,
      invitedBy: a.teacher,
      email: ahmed.email,
    });
    const inB = await createInvitation({
      workspace: workspaceB,
      invitedBy: teacherB,
      email: ahmed.email,
    });
    await db.invitation.update({
      where: { id: first.invitation.id },
      data: { lastSentAt: new Date(Date.now() - 11 * MIN) },
    });
    await (
      await agent(a.teacher)
    )
      .post(`/api/v1/workspaces/${a.workspace.id}/invitations/${first.invitation.id}/resend`)
      .expect(200);
    const s = await agent(ahmed);
    await s
      .get(preview(first.token))
      .expect(410)
      .expect(({ body }) => expect(body.code).toBe('TOKEN_INVALID'));
    await s
      .post(accept(first.token))
      .send({ mode: 'JOIN' })
      .expect(410)
      .expect(({ body }) => expect(body.code).toBe('TOKEN_INVALID'));
    const [mail] = ctx.email.findByTemplate('invitation.received_student', ahmed.email);
    const fresh = extractFirstLink(mail!.html, '/invite/')!.split('/').pop()!;

    // Each token resolves its own workspace only.
    expect((await s.get(preview(fresh)).expect(200)).body.workspace.id).toBe(a.workspace.id);
    expect((await s.get(preview(inB.token)).expect(200)).body.workspace.id).toBe(workspaceB.id);
    await s.post(accept(fresh)).send({ mode: 'JOIN' }).expect(201);
    expect(await db.membership.count({ where: { userId: ahmed.id } })).toBe(1);
    expect(
      (await db.invitation.findUniqueOrThrow({ where: { id: inB.invitation.id } })).status,
    ).toBe('PENDING');
    await s.post(accept(inB.token)).send({ mode: 'JOIN' }).expect(201);
    expect(await db.membership.count({ where: { userId: ahmed.id } })).toBe(2);
  });

  it('GuardianRequestService.resend: 429 within 10 minutes of the last send, then a new token, a new 14-day expiry and consentResentCount + 1', async () => {
    const { workspace } = await personal();
    const { user: kid } = await createStudent({
      workspace,
      minor: true,
      status: 'PENDING_GUARDIAN_CONSENT',
    });
    const service = ctx.app.get(GuardianRequestService);
    const link = await db.guardianLink.findFirstOrThrow({ where: { studentUserId: kid.id } });
    await expect(
      withTenantTx(workspace.id, (tx) => service.resend(tx, link)),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    const old = new Date(Date.now() - 11 * MIN);
    const aged = await db.guardianLink.update({
      where: { id: link.id },
      data: { consentSentAt: old, consentExpiresAt: new Date(Date.now() + DAY) },
    });
    const { link: next, raw } = await withTenantTx(workspace.id, (tx) => service.resend(tx, aged));
    expect(next.consentTokenHash).toBe(hashOpaqueToken(raw));
    expect(next.consentTokenHash).not.toBe(link.consentTokenHash);
    expect(next.consentResentCount).toBe(1);
    expect(+next.consentExpiresAt! - Date.now()).toBeGreaterThan(GUARDIAN_CONSENT_TTL_MS - MIN);
  });
  it('a SUSPENDED or DELETING workspace refuses the acceptance with 423 WORKSPACE_SUSPENDED: no account, no membership, the invitation stays PENDING', async () => {
    for (const status of ['SUSPENDED', 'DELETING'] as const) {
      await ctx.reset();
      const teacher = await verifiedUser();
      const workspace = await createPersonalWorkspace(teacher, { status });
      const ahmed = await createUser({ email: 'ahmed@example.com', birthDate: adultBirthDate() });
      const joined = await createInvitation({ workspace, invitedBy: teacher, email: ahmed.email });
      const res = await (await agent(ahmed)).post(accept(joined.token)).send({ mode: 'JOIN' });
      expect(res.status, status).toBe(423);
      expect(res.body.code, status).toBe('WORKSPACE_SUSPENDED');
      expect(res.body.details, status).toEqual({ status });

      const fresh = await createInvitation({
        workspace,
        invitedBy: teacher,
        email: 'nour@example.com',
      });
      const reg = await http
        .post(accept(fresh.token))
        .send(register({ birthDate: adultBirthDate() }));
      expect(reg.status, status).toBe(423);
      expect(await db.user.count({ where: { email: 'nour@example.com' } }), status).toBe(0);
      expect(
        await db.membership.count({ where: { workspaceId: workspace.id, role: 'STUDENT' } }),
      ).toBe(0);
      expect(
        (await db.invitation.findMany({ where: { workspaceId: workspace.id } })).map(
          (i) => i.status,
        ),
      ).toEqual(['PENDING', 'PENDING']);
      expect(ctx.email.findByTemplate('invitation.accepted')).toHaveLength(0);
    }
  });
});
