import { hashOpaqueToken, isMinor } from '@nibras/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestContext } from '../helpers/app';
import {
  addMember,
  createGuardianLink,
  createImport,
  createInvitation,
  createInviteLink,
  createOrganization,
  createStudent,
  createUser,
  minorBirthDate,
} from '../helpers/factories';
import { expectMinorInvariant } from '../helpers/invariants';

/** The SP2 fixtures write consistent rows, and `expectMinorInvariant` catches a violation. */
describe('SP2 fixtures and the minor invariant', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  it('createStudent: adults have no guardian link; minors get one matching their status', async () => {
    const owner = await createUser();
    const { workspace } = await createOrganization({ owner });

    const adult = await createStudent({ workspace });
    expect(adult.guardianLink).toBeUndefined();
    expect(isMinor(adult.user.birthDate!.toISOString().slice(0, 10))).toBe(false);

    const active = await createStudent({ workspace, minor: true, invitedBy: owner });
    expect(active.membership).toMatchObject({ status: 'ACTIVE', invitedByUserId: owner.id });
    expect(active.guardianLink).toMatchObject({ status: 'ACTIVE', consentId: expect.any(String) });
    expect(active.guardianLink!.sessionsViewTokenHash).toBe(hashOpaqueToken(active.pageToken!));

    const pending = await createStudent({
      workspace,
      minor: true,
      status: 'PENDING_GUARDIAN_CONSENT',
      guardianEmail: 'parent@example.com',
    });
    expect(pending.guardianLink).toMatchObject({
      status: 'PENDING',
      guardianEmail: 'parent@example.com',
    });
    expect(pending.guardianLink!.consentTokenHash).toBe(hashOpaqueToken(pending.consentToken!));
    expect(pending.guardianLink!.consentExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    const revoked = await createStudent({
      workspace,
      minor: true,
      status: 'SUSPENDED_CONSENT_REVOKED',
    });
    expect(revoked.guardianLink).toMatchObject({ status: 'REVOKED', revokedAt: expect.any(Date) });

    await expectMinorInvariant(ctx.db, workspace.id);
  });

  it('expectMinorInvariant fails on an ACTIVE minor without an unrevoked consent', async () => {
    const owner = await createUser();
    const { workspace } = await createOrganization({ owner });
    const minor = await createUser({ birthDate: minorBirthDate() });
    await addMember(workspace, minor, 'STUDENT');
    await expect(expectMinorInvariant(ctx.db, workspace.id)).rejects.toThrow(/GUARDIAN_PARENTAL/);

    // A revoked consent does not count either.
    await createGuardianLink({ workspace, student: minor, status: 'REVOKED' });
    await expect(expectMinorInvariant(ctx.db, workspace.id)).rejects.toThrow(/GUARDIAN_PARENTAL/);
  });

  it('createInvitation / createInviteLink / createImport write consistent rows', async () => {
    const owner = await createUser();
    const { workspace } = await createOrganization({ owner });

    const { invitation, token } = await createInvitation({
      workspace,
      invitedBy: owner,
      birthDate: '2014-05-02',
    });
    expect(invitation).toMatchObject({
      status: 'PENDING',
      role: 'STUDENT',
      invitedByUserId: owner.id,
    });
    expect(invitation.tokenHash).toBe(hashOpaqueToken(token));
    expect(invitation.birthDate!.toISOString().slice(0, 10)).toBe('2014-05-02');
    expect(invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const { link, code } = await createInviteLink({ workspace, createdBy: owner, maxUses: 1 });
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(link).toMatchObject({ code, maxUses: 1, usesCount: 0, status: 'ACTIVE' });

    const imp = await createImport({
      workspace,
      createdBy: owner,
      rows: [{ line: 2, email: 'a@example.com' }],
    });
    expect(imp).toMatchObject({ status: 'QUEUED', totalRows: 1, validRows: 1 });
    expect(imp.rows).toEqual([
      {
        line: 2,
        email: 'a@example.com',
        firstName: null,
        lastName: null,
        guardianEmail: null,
        birthDate: null,
        courseCodes: [],
      },
    ]);
  });
});
