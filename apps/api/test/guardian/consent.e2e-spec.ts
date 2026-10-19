import { EventEmitter2 } from '@nestjs/event-emitter';
import { GUARDIAN_CONSENT_VERSION, TOKEN_ATTEMPTS_PER_MIN } from '@nibras/contracts';
import type { PrismaClient, User, Workspace } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MEMBERSHIP_ACTIVATED,
  MEMBERSHIP_DEACTIVATED,
  type MembershipActivatedEvent,
  type MembershipDeactivatedEvent,
} from '../../src/members/events';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import {
  createGuardianLink,
  createOrganization,
  createPersonalWorkspace,
  createStudent,
  createUser,
} from '../helpers/factories';
import { expectMinorInvariant } from '../helpers/invariants';

const GRANT = {
  decision: 'GRANT',
  guardianFirstName: 'Fatma',
  guardianLastName: 'Trabelsi',
  relationship: 'PARENT',
  acceptNotice: true,
} as const;
const REFUSE = {
  decision: 'REFUSE',
  guardianFirstName: 'Fatma',
  guardianLastName: 'Trabelsi',
  relationship: 'PARENT',
} as const;

describe('guardian consent page: preview, grant, refuse (AC-INV-10; Review Focus 2)', () => {
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

  const consentUrl = (token: string) => `/api/v1/guardian-consent/${token}`;

  const membershipOf = (workspace: Pick<Workspace, 'id'>, user: Pick<User, 'id'>) =>
    db.membership.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    });

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

  /** Mohamed's PERSONAL workspace with Ahmed (12) waiting for his guardian's consent. */
  async function pendingMinor(
    o: { status?: 'PENDING_GUARDIAN_CONSENT' | 'SUSPENDED_NO_CONSENT' } = {},
  ) {
    const teacher = await createUser({ firstName: 'Mohamed', lastName: 'Ben Ali', locale: 'fr' });
    const workspace = await createPersonalWorkspace(teacher, { name: 'Espace de Mohamed' });
    const student = await createStudent({
      workspace,
      minor: true,
      status: o.status ?? 'PENDING_GUARDIAN_CONSENT',
      invitedBy: teacher,
      guardianEmail: 'fatma@example.com',
      user: { firstName: 'Ahmed', lastName: 'Trabelsi', locale: 'ar' },
    });
    return { teacher, workspace, ...student, token: student.consentToken! };
  }

  it('preview: student, workspace, teacher, expiry, version, notice url — never the guardian email or a birth date', async () => {
    const { token, guardianLink } = await pendingMinor();
    const res = await http.get(consentUrl(token)).expect(200);
    expect(res.body).toEqual({
      student: { firstName: 'Ahmed', lastName: 'Trabelsi' },
      workspace: { name: 'Espace de Mohamed', type: 'PERSONAL' },
      teacher: { firstName: 'Mohamed', lastName: 'Ben Ali' },
      expiresAt: guardianLink!.consentExpiresAt!.toISOString(),
      version: GUARDIAN_CONSENT_VERSION,
      noticeUrl: 'http://localhost:3000/fr/legal/minors',
      state: 'PENDING',
    });
    expect(JSON.stringify(res.body)).not.toContain('fatma@example.com');
  });

  it('AC-INV-10: GRANT → Consent GUARDIAN_PARENTAL (ip, user-agent, version guardian-2026-10, workspaceId), GuardianLink ACTIVE with names, membership ACTIVE, student + teacher emailed, guardian gets the confirmation with a /guardian/ link; the consent token is single-use (second POST → 410 TOKEN_INVALID); expectMinorInvariant', async () => {
    const { teacher, workspace, user: student, token } = await pendingMinor();

    let body: { decision: string; guardianPageUrl?: string } = { decision: '' };
    const events = await collect<MembershipActivatedEvent>(MEMBERSHIP_ACTIVATED, async () => {
      const res = await http
        .post(consentUrl(token))
        .set('User-Agent', 'guardian-browser')
        .send(GRANT)
        .expect(200);
      body = res.body;
    });
    expect(body.decision).toBe('GRANT');
    expect(body.guardianPageUrl).toMatch(
      /^http:\/\/localhost:3000\/fr\/guardian\/[A-Za-z0-9_-]{43}$/,
    );
    expect(events).toEqual([
      expect.objectContaining({ workspaceId: workspace.id, userId: student.id }),
    ]);

    const consent = await db.consent.findFirstOrThrow({
      where: { userId: student.id, type: 'GUARDIAN_PARENTAL' },
    });
    expect(consent).toMatchObject({
      workspaceId: workspace.id,
      version: GUARDIAN_CONSENT_VERSION,
      granted: true,
      revokedAt: null,
      grantedByEmail: 'fatma@example.com',
      userAgent: 'guardian-browser',
    });
    expect(consent.ip).toMatch(/127\.0\.0\.1|::1/);

    const link = await db.guardianLink.findUniqueOrThrow({
      where: {
        studentUserId_workspaceId: { studentUserId: student.id, workspaceId: workspace.id },
      },
    });
    expect(link).toMatchObject({
      status: 'ACTIVE',
      guardianFirstName: 'Fatma',
      guardianLastName: 'Trabelsi',
      relationship: 'PARENT',
      consentId: consent.id,
      consentTokenHash: null,
    });
    expect(link.decidedAt).not.toBeNull();
    expect(link.sessionsViewTokenHash).not.toBeNull();

    const membership = await membershipOf(workspace, student);
    expect(membership.status).toBe('ACTIVE');
    expect(membership.joinedAt).not.toBeNull();
    await expectMinorInvariant(db, workspace.id);

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'guardian.consent_granted' },
    });
    expect(audit).toMatchObject({ workspaceId: workspace.id, actorUserId: null });
    expect(audit.after).toMatchObject({
      studentUserId: student.id,
      relationship: 'PARENT',
      version: GUARDIAN_CONSENT_VERSION,
    });
    expect(JSON.stringify(audit)).not.toContain(token);

    const confirmation = ctx.email.findByTemplate(
      'guardian.consent_confirmation',
      'fatma@example.com',
    );
    expect(confirmation).toHaveLength(1);
    expect(confirmation[0]!.params.link).toBe(body.guardianPageUrl);
    expect(confirmation[0]!.html).toContain('Espace de Mohamed');
    const toStudent = ctx.email.findByTemplate('guardian.consent_granted', student.email);
    expect(toStudent).toHaveLength(1);
    expect(toStudent[0]!.locale).toBe('ar');
    expect(
      ctx.email.findByTemplate('guardian.consent_granted_teacher', teacher.email),
    ).toHaveLength(1);

    // Single use: the consent token is gone.
    const again = await http.post(consentUrl(token)).send(GRANT).expect(410);
    expect(again.body.code).toBe('TOKEN_INVALID');
    await http.get(consentUrl(token)).expect(410);
    expect(await db.consent.count({ where: { type: 'GUARDIAN_PARENTAL' } })).toBe(1);

    // The page link works.
    await http.get(new URL(body.guardianPageUrl!).pathname.replace('/fr/', '/api/v1/')).expect(200);
  });

  it('REFUSE → link REFUSED, membership SUSPENDED_NO_CONSENT, no Consent row, two emails, MembershipDeactivatedEvent', async () => {
    const { teacher, workspace, user: student, token } = await pendingMinor();
    const events = await collect<MembershipDeactivatedEvent>(MEMBERSHIP_DEACTIVATED, async () => {
      const res = await http.post(consentUrl(token)).send(REFUSE).expect(200);
      expect(res.body).toEqual({ decision: 'REFUSE' });
    });
    expect(events).toEqual([
      expect.objectContaining({
        workspaceId: workspace.id,
        userId: student.id,
        status: 'SUSPENDED_NO_CONSENT',
        reason: 'CONSENT_REFUSED',
      }),
    ]);
    const link = await db.guardianLink.findFirstOrThrow({ where: { studentUserId: student.id } });
    expect(link).toMatchObject({ status: 'REFUSED', consentTokenHash: null, consentId: null });
    expect(link.decidedAt).not.toBeNull();
    expect((await membershipOf(workspace, student)).status).toBe('SUSPENDED_NO_CONSENT');
    expect(await db.consent.count({ where: { type: 'GUARDIAN_PARENTAL' } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: 'guardian.consent_refused' } })).toBe(1);
    const refused = ctx.email.findByTemplate('guardian.consent_refused');
    expect(refused.map((m) => [m.to, m.params.recipientRole]).sort()).toEqual(
      [
        [student.email, 'STUDENT'],
        [teacher.email, 'TEACHER'],
      ].sort(),
    );
    await http.post(consentUrl(token)).send(GRANT).expect(410);
  });

  it('preview of an expired link → 410 CONSENT_LINK_EXPIRED; GRANT without acceptNotice → 422 on acceptNotice; relationship outside the enum → 422', async () => {
    const teacher = await createUser();
    const workspace = await createPersonalWorkspace(teacher);
    const student = await createUser({ birthDate: '2015-01-01' });
    const { consentToken } = await createGuardianLink({
      workspace,
      student,
      status: 'PENDING',
      consentExpiresAt: new Date(Date.now() - 1000),
    });
    const expired = await http.get(consentUrl(consentToken!)).expect(410);
    expect(expired.body.code).toBe('CONSENT_LINK_EXPIRED');
    const late = await http.post(consentUrl(consentToken!)).send(GRANT).expect(410);
    expect(late.body.code).toBe('CONSENT_LINK_EXPIRED');

    const { token } = await pendingMinor();
    const noNotice = await http
      .post(consentUrl(token))
      .send({ ...GRANT, acceptNotice: undefined })
      .expect(422);
    expect(noNotice.body.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(noNotice.body)).toContain('acceptNotice');
    await http
      .post(consentUrl(token))
      .send({ ...GRANT, relationship: 'NEIGHBOUR' })
      .expect(422);
    expect(await db.consent.count({ where: { type: 'GUARDIAN_PARENTAL' } })).toBe(0);
  });

  it('unknown and malformed tokens → 410 TOKEN_INVALID, counted per ip: past the limit → 429 even for a valid token', async () => {
    const { token } = await pendingMinor();
    const unknown = 'A'.repeat(43);
    expect((await http.get(consentUrl(unknown)).expect(410)).body.code).toBe('TOKEN_INVALID');
    expect((await http.post(consentUrl('short')).send(GRANT).expect(410)).body.code).toBe(
      'TOKEN_INVALID',
    );
    for (let i = 2; i < TOKEN_ATTEMPTS_PER_MIN; i++)
      await http.get(consentUrl(unknown)).expect(410);
    await http.get(consentUrl(token)).expect(429);
    // The token never reaches the logs.
    expect(JSON.stringify(ctx.logs.lines())).not.toContain(token);
  });

  it('Review Focus 2: GRANT on a link whose membership was REMOVED meanwhile records the consent but leaves the membership REMOVED', async () => {
    const { workspace, user: student, token, membership } = await pendingMinor();
    await db.membership.update({
      where: { id: membership.id },
      data: { status: 'REMOVED', removedAt: new Date(), removalReason: 'test' },
    });
    await collect<MembershipActivatedEvent>(MEMBERSHIP_ACTIVATED, async () => {
      await http.post(consentUrl(token)).send(GRANT).expect(200);
    }).then((events) => expect(events).toEqual([]));
    expect((await membershipOf(workspace, student)).status).toBe('REMOVED');
    expect(
      await db.consent.count({ where: { type: 'GUARDIAN_PARENTAL', userId: student.id } }),
    ).toBe(1);
    expect(
      (await db.guardianLink.findFirstOrThrow({ where: { studentUserId: student.id } })).status,
    ).toBe('ACTIVE');
    // Nobody tells the student or the teacher he was let in.
    expect(ctx.email.findByTemplate('guardian.consent_granted')).toHaveLength(0);
    await expectMinorInvariant(db, workspace.id);
  });

  it('a SUSPENDED_NO_CONSENT member re-asked (expired then resent) becomes ACTIVE on GRANT', async () => {
    const {
      workspace,
      user: student,
      token,
    } = await pendingMinor({ status: 'SUSPENDED_NO_CONSENT' });
    await http.post(consentUrl(token)).send(GRANT).expect(200);
    expect((await membershipOf(workspace, student)).status).toBe('ACTIVE');
    await expectMinorInvariant(db, workspace.id);
  });

  it('GRANT into a SUSPENDED workspace → 423 WORKSPACE_SUSPENDED (nothing written); REFUSE stays possible', async () => {
    const owner = await createUser();
    const { workspace } = await createOrganization({ owner, status: 'SUSPENDED' });
    const s = await createStudent({ workspace, minor: true, status: 'PENDING_GUARDIAN_CONSENT' });
    const res = await http.post(consentUrl(s.consentToken!)).send(GRANT).expect(423);
    expect(res.body.code).toBe('WORKSPACE_SUSPENDED');
    expect(await db.consent.count({ where: { type: 'GUARDIAN_PARENTAL' } })).toBe(0);
    expect((await membershipOf(workspace, s.user)).status).toBe('PENDING_GUARDIAN_CONSENT');
    await http.post(consentUrl(s.consentToken!)).send(REFUSE).expect(200);
    expect((await membershipOf(workspace, s.user)).status).toBe('SUSPENDED_NO_CONSENT');
  });

  it('a concurrent double GRANT: one 200, one 410, one consent row', async () => {
    const { token, user: student } = await pendingMinor();
    const [a, b] = await Promise.all([
      http.post(consentUrl(token)).send(GRANT),
      http.post(consentUrl(token)).send(GRANT),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 410]);
    expect(
      await db.consent.count({ where: { userId: student.id, type: 'GUARDIAN_PARENTAL' } }),
    ).toBe(1);
  });
});
