import { GUARDIAN_CONSENT_TTL_MS, hashOpaqueToken } from '@nibras/contracts';
import { withTenantTx, type GuardianLink, type PrismaClient, type User } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GuardianRequestService } from '../../src/guardian/guardian-request.service';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import { as, loginAs } from '../helpers/auth';
import {
  assign,
  createGuardianLink,
  createOrganization,
  createPersonalWorkspace,
  createStudent,
  createUser,
} from '../helpers/factories';

const S = 'JBSWY3DPEHPK3PXP';
const MINUTE = 60_000;

/** A teacher who passes `@RequireVerifiedTeacher()`. */
const verifiedUser = (o: Parameters<typeof createUser>[0] = {}) =>
  createUser({ phoneVerified: true, consents: ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT'], ...o });

describe('guardian consent resend: teacher and student self-service (AC-INV-12 resend; D12)', () => {
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
  const teacherResend = (wid: string, uid: string) =>
    `/api/v1/workspaces/${wid}/students/${uid}/guardian/resend-consent`;
  const selfResend = (wid: string) => `/api/v1/me/workspaces/${wid}/guardian/resend-consent`;

  /** Moves the link's last send `minutes` back (the 10-minute cooldown has passed). */
  const age = (link: Pick<GuardianLink, 'id'>, minutes: number, data: Partial<GuardianLink> = {}) =>
    db.guardianLink.update({
      where: { id: link.id },
      data: { consentSentAt: new Date(Date.now() - minutes * MINUTE), ...data },
    });

  /** Mohamed (verified) and Ahmed (12) whose guardian never answered (expired → SUSPENDED_NO_CONSENT). */
  async function expiredRequest() {
    const teacher = await verifiedUser({ firstName: 'Mohamed', lastName: 'Ben Ali' });
    const workspace = await createPersonalWorkspace(teacher, { name: 'Espace de Mohamed' });
    const s = await createStudent({
      workspace,
      minor: true,
      status: 'SUSPENDED_NO_CONSENT',
      invitedBy: teacher,
      guardianEmail: 'fatma@example.com',
      user: { firstName: 'Ahmed' },
    });
    await age(s.guardianLink!, 15 * 24 * 60, {
      consentExpiresAt: new Date(Date.now() - 24 * 60 * MINUTE),
    });
    return { teacher, workspace, ...s };
  }

  it('teacher resend → new consent token, 14 d, PENDING link, SUSPENDED_NO_CONSENT membership unchanged until the guardian grants; second resend within 10 min → 429; an ACTIVE member → 409 MEMBERSHIP_NOT_PENDING', async () => {
    const {
      teacher,
      workspace,
      user: student,
      guardianLink,
      consentToken,
    } = await expiredRequest();
    const a = await agent(teacher);

    const res = await a.post(teacherResend(workspace.id, student.id)).expect(200);
    expect(res.body).toMatchObject({
      emailMasked: expect.stringContaining('@'),
      status: 'PENDING',
    });
    expect(res.body.emailMasked).not.toBe('fatma@example.com');
    const expiresAt = new Date(res.body.consentExpiresAt).getTime();
    expect(Math.abs(expiresAt - (Date.now() + GUARDIAN_CONSENT_TTL_MS))).toBeLessThan(MINUTE);

    const link = await db.guardianLink.findUniqueOrThrow({ where: { id: guardianLink!.id } });
    expect(link.status).toBe('PENDING');
    expect(link.consentResentCount).toBe(1);
    expect(link.consentTokenHash).not.toBe(hashOpaqueToken(consentToken!));
    const membership = await db.membership.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: student.id } },
    });
    expect(membership.status).toBe('SUSPENDED_NO_CONSENT');

    const mails = ctx.email.findByTemplate('guardian.consent_requested', 'fatma@example.com');
    expect(mails).toHaveLength(1);
    const raw = (mails[0]!.params.link as string).split('/').pop()!;
    expect(hashOpaqueToken(raw)).toBe(link.consentTokenHash);
    expect(await db.auditLog.count({ where: { action: 'guardian.consent_requested' } })).toBe(1);
    // The previous consent link is dead, the new one opens the consent page.
    await http.get(`/api/v1/guardian-consent/${consentToken}`).expect(410);
    await http.get(`/api/v1/guardian-consent/${raw}`).expect(200);

    const again = await a.post(teacherResend(workspace.id, student.id)).expect(429);
    expect(again.body.code).toBe('RATE_LIMITED');
    expect(again.body.details.retryAfterS).toBeGreaterThan(0);
    expect(ctx.email.findByTemplate('guardian.consent_requested')).toHaveLength(1);

    const adult = await createStudent({ workspace, invitedBy: teacher });
    const active = await a.post(teacherResend(workspace.id, adult.user.id)).expect(409);
    expect(active.body.code).toBe('MEMBERSHIP_NOT_PENDING');
  });

  it('teacher resend after a revocation re-asks the guardian (REVOKED → PENDING) and keeps the membership SUSPENDED_CONSENT_REVOKED', async () => {
    const teacher = await verifiedUser();
    const workspace = await createPersonalWorkspace(teacher);
    const s = await createStudent({
      workspace,
      minor: true,
      status: 'SUSPENDED_CONSENT_REVOKED',
      invitedBy: teacher,
    });
    await age(s.guardianLink!, 30);
    await (await agent(teacher)).post(teacherResend(workspace.id, s.user.id)).expect(200);
    const link = await db.guardianLink.findUniqueOrThrow({ where: { id: s.guardianLink!.id } });
    expect(link.status).toBe('PENDING');
    expect(link.decidedAt).toBeNull();
    expect(link.consentTokenHash).not.toBeNull();
    expect((await db.membership.findUniqueOrThrow({ where: { id: s.membership.id } })).status).toBe(
      'SUSPENDED_CONSENT_REVOKED',
    );
  });

  it('T6 state: a PENDING_APPROVAL minor whose guardian email is recorded (token-less PENDING link) → 409 MEMBERSHIP_NOT_PENDING, nothing sent; the primitive refuses such a link too', async () => {
    const teacher = await verifiedUser();
    const workspace = await createPersonalWorkspace(teacher);
    const s = await createStudent({
      workspace,
      minor: true,
      status: 'PENDING_APPROVAL',
      invitedBy: teacher,
    });
    const link = await db.guardianLink.update({
      where: { id: s.guardianLink!.id },
      data: { consentTokenHash: null, consentExpiresAt: null, consentSentAt: null },
    });
    const res = await (
      await agent(teacher)
    )
      .post(teacherResend(workspace.id, s.user.id))
      .expect(409);
    expect(res.body.code).toBe('MEMBERSHIP_NOT_PENDING');
    expect(ctx.email.sent).toHaveLength(0);

    const primitive = ctx.app.get(GuardianRequestService);
    await expect(
      withTenantTx(workspace.id, (tx) => primitive.resend(tx, link)),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_NOT_PENDING' });
    const active = await createGuardianLink({
      workspace,
      student: await createUser(),
      status: 'ACTIVE',
    });
    await expect(
      withTenantTx(workspace.id, (tx) => primitive.resend(tx, active.link)),
    ).rejects.toMatchObject({ code: 'CONSENT_ALREADY_DECIDED' });
    const unchanged = await db.guardianLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(unchanged).toMatchObject({ consentTokenHash: null, consentResentCount: 0 });
  });

  it('teacher scope: an organisation TEACHER resends only for his own students (else 404); an unknown or foreign uid → 404', async () => {
    const owner = await createUser({ totpSecret: S });
    const mine = await verifiedUser();
    const other = await verifiedUser();
    const { workspace } = await createOrganization({ owner, teachers: [mine, other] });
    const s = await createStudent({
      workspace,
      minor: true,
      status: 'PENDING_GUARDIAN_CONSENT',
      invitedBy: owner,
    });
    await assign(workspace, mine, s.user, owner);
    await age(s.guardianLink!, 30);

    await (await agent(other)).post(teacherResend(workspace.id, s.user.id)).expect(404);
    await (await agent(mine)).post(teacherResend(workspace.id, s.user.id)).expect(200);

    const elsewhere = await createPersonalWorkspace(await createUser());
    const foreign = await createStudent({
      workspace: elsewhere,
      minor: true,
      status: 'PENDING_GUARDIAN_CONSENT',
    });
    await (await agent(mine)).post(teacherResend(workspace.id, foreign.user.id)).expect(404);
    await (await agent(mine)).post(teacherResend(workspace.id, 'not-a-uuid')).expect(404);
  });

  it('student self-resend on /me/workspaces/{wid}/guardian/resend-consent works while his membership is inactive; another workspace id → 404; /me/workspaces carries guardian { emailMasked, status, consentExpiresAt }', async () => {
    const teacher = await createUser({ firstName: 'Mohamed' });
    const workspace = await createPersonalWorkspace(teacher, { name: 'Espace de Mohamed' });
    const s = await createStudent({
      workspace,
      minor: true,
      status: 'PENDING_GUARDIAN_CONSENT',
      invitedBy: teacher,
      guardianEmail: 'fatma@example.com',
    });
    await age(s.guardianLink!, 30);
    const me = await agent(s.user);

    // The workspace itself is closed to him…
    const blocked = await me.get(`/api/v1/workspaces/${workspace.id}`).expect(403);
    expect(blocked.body.code).toBe('GUARDIAN_CONSENT_REQUIRED');
    // …but the /me route works.
    const res = await me.post(selfResend(workspace.id)).expect(200);
    expect(res.body.status).toBe('PENDING');
    expect(
      ctx.email.findByTemplate('guardian.consent_requested', 'fatma@example.com'),
    ).toHaveLength(1);
    expect((await me.post(selfResend(workspace.id)).expect(429)).body.code).toBe('RATE_LIMITED');

    const list = await me.get('/api/v1/me/workspaces').expect(200);
    const link = await db.guardianLink.findUniqueOrThrow({ where: { id: s.guardianLink!.id } });
    expect(list.body).toEqual([
      expect.objectContaining({
        workspace: expect.objectContaining({ id: workspace.id }),
        status: 'PENDING_GUARDIAN_CONSENT',
        guardian: {
          emailMasked: expect.not.stringMatching(/^fatma@example\.com$/),
          status: 'PENDING',
          consentExpiresAt: link.consentExpiresAt!.toISOString(),
        },
      }),
    ]);

    // Another workspace (not his, or his but foreign id) → 404, never a 403.
    const strange = await createPersonalWorkspace(await createUser());
    expect((await me.post(selfResend(strange.id)).expect(404)).body.code).toBe('NOT_FOUND');
    await me.post(selfResend('not-a-uuid')).expect(404);
    // An ACTIVE adult student has nothing to resend.
    const adult = await createStudent({ workspace });
    expect(
      (await (await agent(adult.user)).post(selfResend(workspace.id)).expect(409)).body.code,
    ).toBe('MEMBERSHIP_NOT_PENDING');
  });

  it('/me/workspaces: guardian is null for a staff membership and for an adult student; a token-less PENDING link (approval pending) is reported without an expiry', async () => {
    const teacher = await createUser();
    const workspace = await createPersonalWorkspace(teacher);
    const list = await (await agent(teacher)).get('/api/v1/me/workspaces').expect(200);
    expect(list.body[0].guardian).toBeNull();

    const adult = await createStudent({ workspace });
    expect(
      (await (await agent(adult.user)).get('/api/v1/me/workspaces').expect(200)).body[0].guardian,
    ).toBeNull();

    const waiting = await createStudent({ workspace, minor: true, status: 'PENDING_APPROVAL' });
    await db.guardianLink.update({
      where: { id: waiting.guardianLink!.id },
      data: { consentTokenHash: null, consentExpiresAt: null, consentSentAt: null },
    });
    const own = await (await agent(waiting.user)).get('/api/v1/me/workspaces').expect(200);
    expect(own.body[0].guardian).toMatchObject({ status: 'PENDING', consentExpiresAt: null });
  });

  it('self-resend into a SUSPENDED workspace → 423 WORKSPACE_SUSPENDED, nothing sent', async () => {
    const owner = await createUser();
    const { workspace } = await createOrganization({ owner, status: 'SUSPENDED' });
    const s = await createStudent({ workspace, minor: true, status: 'PENDING_GUARDIAN_CONSENT' });
    await age(s.guardianLink!, 30);
    const res = await (await agent(s.user)).post(selfResend(workspace.id)).expect(423);
    expect(res.body.code).toBe('WORKSPACE_SUSPENDED');
    expect(ctx.email.sent).toHaveLength(0);
  });
});
