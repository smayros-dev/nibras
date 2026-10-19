import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaClient, User, Workspace } from '@nibras/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MEMBERSHIP_DEACTIVATED, type MembershipDeactivatedEvent } from '../../src/members/events';
import { createTestApp, type TestAgent, type TestContext } from '../helpers/app';
import {
  addMember,
  createGuardianLink,
  createOrganization,
  createPersonalWorkspace,
  createStudent,
  createUser,
} from '../helpers/factories';
import { expectMinorInvariant } from '../helpers/invariants';

const REGRANT = {
  guardianFirstName: 'Fatma',
  guardianLastName: 'Trabelsi',
  relationship: 'LEGAL_GUARDIAN',
  acceptNotice: true,
} as const;

describe('guardian page: view, revoke, re-grant (AC-INV-11, AC-SAFE-06; Review Focus 4)', () => {
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

  const page = (token: string) => `/api/v1/guardian/${token}`;

  const statusOf = async (workspace: Pick<Workspace, 'id'>, user: Pick<User, 'id'>) =>
    (
      await db.membership.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
      })
    ).status;

  /**
   * Ahmed (12), ACTIVE with his guardian's consent in A (Mohamed's PERSONAL workspace) and in B
   * (an organisation with an admin), the same guardian email in both.
   */
  async function ahmedInTwoWorkspaces() {
    const teacher = await createUser({ firstName: 'Mohamed', lastName: 'Ben Ali' });
    const A = await createPersonalWorkspace(teacher, { name: 'Espace de Mohamed' });
    const s = await createStudent({
      workspace: A,
      minor: true,
      invitedBy: teacher,
      guardianEmail: 'fatma@example.com',
      user: { firstName: 'Ahmed', lastName: 'Trabelsi' },
    });
    const owner = await createUser({ firstName: 'Salma', lastName: 'Org' });
    const admin = await createUser({ firstName: 'Admin', lastName: 'Org' });
    const { workspace: B } = await createOrganization({
      owner,
      admins: [admin],
      name: 'Académie B',
    });
    await addMember(B, s.user, 'STUDENT', { invitedByUserId: owner.id });
    const inB = await createGuardianLink({
      workspace: B,
      student: s.user,
      status: 'ACTIVE',
      guardianEmail: 'fatma@example.com',
    });
    return {
      teacher,
      A,
      B,
      owner,
      admin,
      student: s.user,
      tokenA: s.pageToken!,
      tokenB: inB.pageToken!,
    };
  }

  it('AC-SAFE-06: the page of (Ahmed, A) shows Ahmed, workspace A, the teacher and sessions: []; the same guardian consented in B → B is not in the payload; an A token never reads B rows (Review Focus 4)', async () => {
    const { A, B, tokenA, tokenB } = await ahmedInTwoWorkspaces();
    const res = await http.get(page(tokenA)).expect(200);
    expect(res.body).toMatchObject({
      student: { firstName: 'Ahmed', lastName: 'Trabelsi' },
      workspace: { id: A.id, name: 'Espace de Mohamed', type: 'PERSONAL' },
      teacher: { firstName: 'Mohamed', lastName: 'Ben Ali' },
      link: { status: 'ACTIVE', revokedAt: null },
      sessions: [],
    });
    expect(res.body.link.grantedAt).not.toBeNull();
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(B.id);
    expect(text).not.toContain('Académie B');
    expect(text).not.toContain('fatma@example.com');

    const resB = await http.get(page(tokenB)).expect(200);
    expect(resB.body.workspace).toMatchObject({ id: B.id, name: 'Académie B' });
    expect(JSON.stringify(resB.body)).not.toContain(A.id);
    // The consent page token space and the guardian page token space are distinct.
    expect((await http.get(`/api/v1/guardian-consent/${tokenA}`).expect(410)).body.code).toBe(
      'TOKEN_INVALID',
    );
  });

  it('AC-INV-11: revoke in A → SUSPENDED_CONSENT_REVOKED in A within the request, consent.revokedAt set, B stays ACTIVE, teacher + admin emailed, no row deleted (user, consents, memberships counts unchanged); revoke again → 409 GUARDIAN_LINK_INACTIVE', async () => {
    const { teacher, A, B, owner, admin, student, tokenA } = await ahmedInTwoWorkspaces();
    const counts = async () => ({
      users: await db.user.count(),
      consents: await db.consent.count(),
      memberships: await db.membership.count(),
      links: await db.guardianLink.count(),
    });
    const before = await counts();

    const events: MembershipDeactivatedEvent[] = [];
    const emitter = ctx.app.get(EventEmitter2);
    const listener = (e: MembershipDeactivatedEvent) => events.push(e);
    emitter.on(MEMBERSHIP_DEACTIVATED, listener);
    try {
      await http.post(`${page(tokenA)}/revoke`).expect(204);
      await new Promise((r) => setImmediate(r));
    } finally {
      emitter.off(MEMBERSHIP_DEACTIVATED, listener);
    }

    expect(await statusOf(A, student)).toBe('SUSPENDED_CONSENT_REVOKED');
    expect(await statusOf(B, student)).toBe('ACTIVE');
    const consentA = await db.consent.findFirstOrThrow({
      where: { userId: student.id, workspaceId: A.id, type: 'GUARDIAN_PARENTAL' },
    });
    expect(consentA.revokedAt).not.toBeNull();
    const consentB = await db.consent.findFirstOrThrow({
      where: { userId: student.id, workspaceId: B.id, type: 'GUARDIAN_PARENTAL' },
    });
    expect(consentB.revokedAt).toBeNull();
    const linkA = await db.guardianLink.findFirstOrThrow({
      where: { studentUserId: student.id, workspaceId: A.id },
    });
    expect(linkA.status).toBe('REVOKED');
    expect(linkA.revokedAt).not.toBeNull();
    expect(
      (
        await db.guardianLink.findFirstOrThrow({
          where: { studentUserId: student.id, workspaceId: B.id },
        })
      ).status,
    ).toBe('ACTIVE');
    expect(await counts()).toEqual(before);
    await expectMinorInvariant(db, A.id);
    await expectMinorInvariant(db, B.id);

    expect(events).toEqual([
      expect.objectContaining({
        workspaceId: A.id,
        userId: student.id,
        status: 'SUSPENDED_CONSENT_REVOKED',
        reason: 'CONSENT_REVOKED',
      }),
    ]);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'guardian.consent_revoked' },
    });
    expect(audit.workspaceId).toBe(A.id);
    const revoked = ctx.email.findByTemplate('guardian.consent_revoked');
    expect(revoked.map((m) => m.to).sort()).toEqual([student.email, teacher.email].sort());
    expect(revoked.find((m) => m.to === teacher.email)!.params.recipientRole).toBe('TEACHER');
    // B's staff hear nothing about A.
    expect(revoked.map((m) => m.to)).not.toContain(owner.email);
    expect(revoked.map((m) => m.to)).not.toContain(admin.email);

    // The page still shows the (revoked) link; a second revoke is refused.
    const view = await http.get(page(tokenA)).expect(200);
    expect(view.body.link).toMatchObject({ status: 'REVOKED' });
    expect((await http.post(`${page(tokenA)}/revoke`).expect(409)).body.code).toBe(
      'GUARDIAN_LINK_INACTIVE',
    );
  });

  it('revoke in an organisation emails the student, his teacher and every ACTIVE OWNER / ADMIN', async () => {
    const { B, owner, admin, student, tokenB } = await ahmedInTwoWorkspaces();
    const exAdmin = await createUser();
    await addMember(B, exAdmin, 'ADMIN', { status: 'REMOVED' });
    await http.post(`${page(tokenB)}/revoke`).expect(204);
    expect(await statusOf(B, student)).toBe('SUSPENDED_CONSENT_REVOKED');
    const to = ctx.email.findByTemplate('guardian.consent_revoked').map((m) => m.to);
    expect(to.sort()).toEqual([student.email, owner.email, admin.email].sort());
  });

  it('re-grant after revocation → new Consent row, membership ACTIVE, the old page token answers 410, the new page works', async () => {
    const { A, student, tokenA } = await ahmedInTwoWorkspaces();
    await http.post(`${page(tokenA)}/revoke`).expect(204);
    // A re-grant needs the notice.
    await http
      .post(`${page(tokenA)}/grant`)
      .send({ ...REGRANT, acceptNotice: undefined })
      .expect(422);

    const res = await http
      .post(`${page(tokenA)}/grant`)
      .send(REGRANT)
      .expect(200);
    expect(res.body.guardianPageUrl).toMatch(/\/fr\/guardian\/[A-Za-z0-9_-]{43}$/);
    const newToken = res.body.guardianPageUrl.split('/').pop() as string;
    expect(newToken).not.toBe(tokenA);

    const consents = await db.consent.findMany({
      where: { userId: student.id, workspaceId: A.id, type: 'GUARDIAN_PARENTAL' },
      orderBy: { createdAt: 'asc' },
    });
    expect(consents).toHaveLength(2);
    expect(consents[0]!.revokedAt).not.toBeNull();
    expect(consents[1]!.revokedAt).toBeNull();
    const link = await db.guardianLink.findFirstOrThrow({
      where: { studentUserId: student.id, workspaceId: A.id },
    });
    expect(link).toMatchObject({
      status: 'ACTIVE',
      consentId: consents[1]!.id,
      relationship: 'LEGAL_GUARDIAN',
      revokedAt: null,
    });
    expect(await statusOf(A, student)).toBe('ACTIVE');
    await expectMinorInvariant(db, A.id);
    expect(await db.auditLog.count({ where: { action: 'guardian.consent_granted' } })).toBe(1);

    expect((await http.get(page(tokenA)).expect(410)).body.code).toBe('TOKEN_INVALID');
    await http.post(`${page(tokenA)}/revoke`).expect(410);
    await http.get(page(newToken)).expect(200);
    // Re-granting an ACTIVE link is refused.
    expect(
      (
        await http
          .post(`${page(newToken)}/grant`)
          .send(REGRANT)
          .expect(409)
      ).body.code,
    ).toBe('GUARDIAN_LINK_INACTIVE');
  });

  it('re-grant after a refusal (page token kept from an earlier grant) activates the SUSPENDED_NO_CONSENT member', async () => {
    const teacher = await createUser();
    const workspace = await createPersonalWorkspace(teacher);
    const s = await createStudent({
      workspace,
      minor: true,
      status: 'SUSPENDED_CONSENT_REVOKED',
      invitedBy: teacher,
    });
    await db.guardianLink.update({
      where: { id: s.guardianLink!.id },
      data: { status: 'REFUSED' },
    });
    await db.membership.update({
      where: { id: s.membership.id },
      data: { status: 'SUSPENDED_NO_CONSENT' },
    });
    await http
      .post(`${page(s.pageToken!)}/grant`)
      .send(REGRANT)
      .expect(200);
    expect(await statusOf(workspace, s.user)).toBe('ACTIVE');
    await expectMinorInvariant(db, workspace.id);
  });

  it('re-grant into a SUSPENDED workspace → 423; revoke stays possible there', async () => {
    const owner = await createUser();
    const { workspace } = await createOrganization({ owner, status: 'SUSPENDED' });
    const s = await createStudent({ workspace, minor: true });
    await http.post(`${page(s.pageToken!)}/revoke`).expect(204);
    expect(await statusOf(workspace, s.user)).toBe('SUSPENDED_CONSENT_REVOKED');
    const res = await http
      .post(`${page(s.pageToken!)}/grant`)
      .send(REGRANT)
      .expect(423);
    expect(res.body.code).toBe('WORKSPACE_SUSPENDED');
    expect(await statusOf(workspace, s.user)).toBe('SUSPENDED_CONSENT_REVOKED');
  });

  it('unknown tokens → 410 TOKEN_INVALID on every page route', async () => {
    const unknown = 'B'.repeat(43);
    for (const res of [
      await http.get(page(unknown)),
      await http.post(`${page(unknown)}/revoke`),
      await http.post(`${page(unknown)}/grant`).send(REGRANT),
    ]) {
      expect(res.status).toBe(410);
      expect(res.body.code).toBe('TOKEN_INVALID');
    }
  });
});
