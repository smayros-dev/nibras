import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, systemPrisma, TENANT_MODELS } from './index';

const P2002 = { code: 'P2002' };

function newUser(email: string) {
  return systemPrisma().user.create({ data: { email, firstName: 'A', lastName: 'B' } });
}

function newWorkspace(ownerUserId: string, slug: string) {
  return systemPrisma().workspace.create({
    data: {
      type: 'PERSONAL',
      name: 'Espace de A',
      slug,
      ownerUserId,
      defaultTimezone: 'Africa/Tunis',
      defaultLocale: 'fr',
      storageQuotaBytes: 20n * 1024n ** 3n,
      settings: {},
    },
  });
}

describe('TENANT_MODELS', () => {
  it("lists SP1's tenant tables", () => {
    expect(TENANT_MODELS).toEqual(['Membership', 'TeacherStudentAssignment', 'TeacherProfile']);
  });
});

describe.skipIf(!process.env.DATABASE_URL_TEST)('identity schema', () => {
  beforeEach(() => resetDatabase());

  it('email is case-insensitive unique (citext)', async () => {
    await newUser('ahmed@example.com');
    await expect(newUser('Ahmed@Example.COM')).rejects.toMatchObject(P2002);
  });

  it('ids are uuid v7 and timestamps default', async () => {
    const u = await newUser('x@example.com');
    expect(u.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(u.createdAt).toBeInstanceOf(Date);
    expect(u.updatedAt).toBeInstanceOf(Date);
    expect(u.locale).toBe('fr');
    expect(u.timezone).toBe('Africa/Tunis');
    expect(u.platformRole).toBe('NONE');
    expect(u.status).toBe('ACTIVE');
    expect(u.recoveryCodesHash).toEqual([]);
  });

  it('workspace slug is case-insensitive unique (citext)', async () => {
    const u = await newUser('o@example.com');
    await newWorkspace(u.id, 'espace-de-a-abcdef');
    await expect(newWorkspace(u.id, 'Espace-De-A-ABCDEF')).rejects.toMatchObject(P2002);
  });

  it('one membership per (workspace, user) and one guardian consent per (user, workspace)', async () => {
    const db = systemPrisma();
    const owner = await newUser('owner@example.com');
    const student = await newUser('student@example.com');
    const ws = await newWorkspace(owner.id, 'ws-aaaaaa');

    const membership = {
      workspaceId: ws.id,
      userId: student.id,
      role: 'STUDENT',
      status: 'ACTIVE',
    } as const;
    const m = await db.membership.create({ data: membership });
    expect(m.canTeach).toBe(false);
    await expect(
      db.membership.create({ data: { ...membership, role: 'TEACHER' } }),
    ).rejects.toMatchObject(P2002);

    const guardian = {
      userId: student.id,
      workspaceId: ws.id,
      type: 'GUARDIAN_PARENTAL',
      version: 'guardian-2026-10',
      granted: true,
      grantedAt: new Date(),
      grantedByEmail: 'Parent@Example.com',
      ip: '127.0.0.1',
      userAgent: 'vitest',
    } as const;
    const first = await db.consent.create({ data: guardian });
    await expect(db.consent.create({ data: guardian })).rejects.toMatchObject(P2002);
    await db.consent.update({ where: { id: first.id }, data: { revokedAt: new Date() } });
    await expect(db.consent.create({ data: guardian })).resolves.toMatchObject({ revokedAt: null });

    // The partial unique index targets GUARDIAN_PARENTAL only: other types may repeat.
    const terms = {
      ...guardian,
      workspaceId: null,
      type: 'TERMS',
      version: 'terms-2026-10',
    } as const;
    await db.consent.create({ data: terms });
    await expect(db.consent.create({ data: terms })).resolves.toBeDefined();
  });

  it('one assignment per (workspace, teacher, student) and one teacher profile per (workspace, user)', async () => {
    const db = systemPrisma();
    const teacher = await newUser('t@example.com');
    const student = await newUser('s@example.com');
    const ws = await newWorkspace(teacher.id, 'ws-bbbbbb');
    const a = {
      workspaceId: ws.id,
      teacherUserId: teacher.id,
      studentUserId: student.id,
      assignedByUserId: teacher.id,
    };
    await db.teacherStudentAssignment.create({ data: a });
    await expect(db.teacherStudentAssignment.create({ data: a })).rejects.toMatchObject(P2002);

    const p = { workspaceId: ws.id, userId: teacher.id, bio: 'Maths' };
    const profile = await db.teacherProfile.create({ data: p });
    expect(profile.subjects).toEqual([]);
    await expect(db.teacherProfile.create({ data: p })).rejects.toMatchObject(P2002);
  });

  it('workspace defaults: ACTIVE, allowPersonalWorkspaces true, storageUsedBytes 0', async () => {
    const u = await newUser('w@example.com');
    const ws = await newWorkspace(u.id, 'ws-cccccc');
    expect(ws).toMatchObject({
      status: 'ACTIVE',
      allowPersonalWorkspaces: true,
      storageUsedBytes: 0n,
      aiEnabled: false,
      suspendedAt: null,
    });
  });

  it('session, verification token, phone OTP, audit log and abuse report round-trip', async () => {
    const db = systemPrisma();
    const u = await newUser('r@example.com');
    const in1h = new Date(Date.now() + 3_600_000);
    const s = await db.userSession.create({
      data: {
        userId: u.id,
        refreshTokenHash: 'h1',
        familyId: u.id,
        deviceLabel: 'Firefox on Linux',
        ip: '203.0.113.7',
        userAgent: 'vitest',
        lastSeenAt: new Date(),
        expiresAt: in1h,
      },
    });
    expect(s.revokedAt).toBeNull();
    await expect(
      db.userSession.create({ data: { ...s, id: undefined, familyId: s.familyId } }),
    ).rejects.toMatchObject(P2002);

    const t = await db.verificationToken.create({
      data: { userId: u.id, purpose: 'EMAIL_VERIFY', tokenHash: 'th', expiresAt: in1h },
    });
    expect(t).toMatchObject({ usedAt: null, payload: null });
    const otp = await db.phoneOtp.create({
      data: { userId: u.id, phoneE164: '+21620000000', codeHash: 'ch', expiresAt: in1h },
    });
    expect(otp.attempts).toBe(0);

    const log = await db.auditLog.create({
      data: {
        actorUserId: u.id,
        actorRole: 'NONE',
        action: 'auth.login',
        entityType: 'User',
        entityId: u.id,
        requestId: 'req-1',
      },
    });
    expect(log).not.toHaveProperty('updatedAt');

    const report = await db.abuseReport.create({
      data: {
        reporterUserId: u.id,
        category: 'HARASSMENT',
        description: 'x',
        entityType: 'USER',
        entityId: u.id,
        contextSnapshot: { firstName: 'A' },
        status: 'OPEN',
      },
    });
    expect(report.attachments).toEqual([]);
  });
});
