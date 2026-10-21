import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, systemPrisma, TENANT_MODELS } from './index';

const P2002 = { code: 'P2002' };

function newUser(email: string) {
  return systemPrisma().user.create({ data: { email, firstName: 'A', lastName: 'B' } });
}

function newWorkspace(
  ownerUserId: string,
  slug: string,
  type: 'PERSONAL' | 'ORGANIZATION' = 'PERSONAL',
) {
  return systemPrisma().workspace.create({
    data: {
      type,
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
  it("lists SP1's, SP2's and SP3's tenant tables", () => {
    expect(TENANT_MODELS).toEqual([
      'Membership',
      'TeacherStudentAssignment',
      'TeacherProfile',
      'Invitation',
      'InviteLink',
      'GuardianLink',
      'InvitationImport',
      'Course',
      'Module',
      'Lesson',
      'MediaAsset',
      'Enrollment',
      'LessonProgress',
    ]);
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
    await newWorkspace(u.id, 'espace-de-a-abcdef', 'ORGANIZATION');
    await expect(newWorkspace(u.id, 'Espace-De-A-ABCDEF', 'ORGANIZATION')).rejects.toMatchObject({
      ...P2002,
      meta: { target: ['slug'] },
    });
  });

  it('one live PERSONAL workspace per owner; organisations and soft-deleted ones do not count', async () => {
    const db = systemPrisma();
    const u = await newUser('p@example.com');
    const first = await newWorkspace(u.id, 'perso-aaaaaa');
    await expect(newWorkspace(u.id, 'perso-bbbbbb')).rejects.toMatchObject(P2002);
    await expect(newWorkspace(u.id, 'org-aaaaaa', 'ORGANIZATION')).resolves.toBeDefined();
    await expect(newWorkspace(u.id, 'org-bbbbbb', 'ORGANIZATION')).resolves.toBeDefined();
    await db.workspace.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    await expect(newWorkspace(u.id, 'perso-cccccc')).resolves.toBeDefined();
  });

  it('consent workspace scope: account-level types have no workspace, the others require one', async () => {
    const db = systemPrisma();
    const owner = await newUser('co@example.com');
    const ws = await newWorkspace(owner.id, 'ws-scope1');
    const base = {
      userId: owner.id,
      version: 'v1',
      granted: true,
      grantedAt: new Date(),
      ip: '127.0.0.1',
      userAgent: 'vitest',
    };
    const check = /consent_workspace_scope_check/;
    await expect(
      db.consent.create({ data: { ...base, type: 'GUARDIAN_PARENTAL', workspaceId: null } }),
    ).rejects.toThrow(check);
    await expect(
      db.consent.create({ data: { ...base, type: 'RECORDING', workspaceId: null } }),
    ).rejects.toThrow(check);
    await expect(
      db.consent.create({ data: { ...base, type: 'TERMS', workspaceId: ws.id } }),
    ).rejects.toThrow(check);
    await expect(
      db.consent.create({ data: { ...base, type: 'MARKETING', workspaceId: ws.id } }),
    ).rejects.toThrow(check);
    for (const type of ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT', 'MARKETING'] as const)
      await expect(db.consent.create({ data: { ...base, type } })).resolves.toBeDefined();
    for (const type of ['GUARDIAN_PARENTAL', 'RECORDING', 'AI_PROCESSING', 'WHATSAPP'] as const)
      await expect(
        db.consent.create({ data: { ...base, type, workspaceId: ws.id } }),
      ).resolves.toBeDefined();
  });

  it('array columns are NOT NULL with an empty-array default', async () => {
    const cols = await systemPrisma().$queryRaw<
      { table_name: string; column_name: string; is_nullable: string; column_default: string }[]
    >`
      SELECT table_name::text, column_name::text, is_nullable::text, column_default::text
      FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'ARRAY'
      ORDER BY table_name, column_name`;
    expect(cols).toEqual([
      expect.objectContaining({
        table_name: 'abuse_report',
        column_name: 'attachments',
        is_nullable: 'NO',
      }),
      expect.objectContaining({
        table_name: 'invitation',
        column_name: 'course_ids',
        is_nullable: 'NO',
      }),
      expect.objectContaining({
        table_name: 'invite_link',
        column_name: 'course_ids',
        is_nullable: 'NO',
      }),
      expect.objectContaining({
        table_name: 'teacher_profile',
        column_name: 'subjects',
        is_nullable: 'NO',
      }),
      expect.objectContaining({
        table_name: 'user',
        column_name: 'recovery_codes_hash',
        is_nullable: 'NO',
      }),
    ]);
    for (const c of cols) expect(c.column_default).toMatch(/^(ARRAY\[\]|'\{\}')/);
  });

  it('every foreign-key column to user is the leading column of some index', async () => {
    const unindexed = await systemPrisma().$queryRaw<{ fk: string }[]>`
      SELECT c.conrelid::regclass::text || '.' || a.attname AS fk
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = '"user"'::regclass
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])
      ORDER BY 1`;
    expect(unindexed).toEqual([]);
    const [{ ok }] = await systemPrisma().$queryRaw<[{ ok: boolean }]>`
      SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'teacher_student_assignment'
        AND indexdef LIKE '%(workspace_id, student_user_id)') AS ok`;
    expect(ok).toBe(true);
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

  it('one OWNER membership per workspace (partial unique index), any status', async () => {
    const db = systemPrisma();
    const a = await newUser('owner-a@example.com');
    const b = await newUser('owner-b@example.com');
    const w = await newWorkspace(a.id, 'org-owner1', 'ORGANIZATION');
    const w2 = await newWorkspace(a.id, 'org-owner2', 'ORGANIZATION');
    const owner = (workspaceId: string, userId: string, status: 'ACTIVE' | 'REMOVED' = 'ACTIVE') =>
      db.membership.create({ data: { workspaceId, userId, role: 'OWNER', status } });

    const first = await owner(w.id, a.id);
    await expect(owner(w.id, b.id)).rejects.toMatchObject({
      ...P2002,
      meta: { target: ['workspace_id'] },
    });
    // Other roles are not constrained; another workspace has its own OWNER.
    await expect(
      db.membership.create({
        data: { workspaceId: w.id, userId: b.id, role: 'ADMIN', status: 'ACTIVE' },
      }),
    ).resolves.toBeDefined();
    await expect(owner(w2.id, b.id)).resolves.toBeDefined();
    // Promoting the ADMIN while A is still OWNER fails too.
    await expect(
      db.membership.update({
        where: { workspaceId_userId: { workspaceId: w.id, userId: b.id } },
        data: { role: 'OWNER' },
      }),
    ).rejects.toMatchObject(P2002);
    // A REMOVED OWNER still counts.
    await db.membership.update({ where: { id: first.id }, data: { status: 'REMOVED' } });
    await expect(
      db.membership.update({
        where: { workspaceId_userId: { workspaceId: w.id, userId: b.id } },
        data: { role: 'OWNER' },
      }),
    ).rejects.toMatchObject(P2002);
    const constraint = await db.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'membership_owner_per_workspace_key'`;
    expect(constraint).toHaveLength(1);
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

  it('one PENDING invitation per (workspace, email); ACCEPTED/REVOKED rows do not collide', async () => {
    const db = systemPrisma();
    const owner = await newUser('inv-owner@example.com');
    const w = await newWorkspace(owner.id, 'ws-inv1');
    const w2 = await newWorkspace(owner.id, 'org-inv2', 'ORGANIZATION');
    let n = 0;
    const invite = (
      workspaceId: string,
      email: string,
      status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED' = 'PENDING',
    ) =>
      db.invitation.create({
        data: {
          workspaceId,
          email,
          role: 'STUDENT',
          tokenHash: `hash-${++n}`,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
          status,
          invitedByUserId: owner.id,
          lastSentAt: new Date(),
        },
      });

    const first = await invite(w.id, 'eleve@example.com');
    expect(first).toMatchObject({
      courseIds: [],
      resentCount: 0,
      teacherUserId: null,
      acceptedByUserId: null,
      birthDate: null,
    });
    await expect(invite(w.id, 'eleve@example.com')).rejects.toMatchObject({
      ...P2002,
      meta: { target: ['workspace_id', 'email'] },
    });
    // citext: case variants of the same address collide.
    await expect(invite(w.id, 'Eleve@Example.COM')).rejects.toMatchObject(P2002);
    // Non-PENDING rows of the same address do not.
    for (const status of ['ACCEPTED', 'REVOKED', 'EXPIRED'] as const)
      await expect(invite(w.id, 'eleve@example.com', status)).resolves.toBeDefined();
    // Another workspace has its own PENDING invitation.
    await expect(invite(w2.id, 'eleve@example.com')).resolves.toBeDefined();
    // Once the first is revoked, a new PENDING one may be created.
    await db.invitation.update({ where: { id: first.id }, data: { status: 'REVOKED' } });
    await expect(invite(w.id, 'ELEVE@example.com')).resolves.toBeDefined();
    // tokenHash is unique on its own.
    await expect(
      db.invitation.create({
        data: {
          workspaceId: w.id,
          email: 'other@example.com',
          role: 'STUDENT',
          tokenHash: 'hash-1',
          expiresAt: new Date(),
          status: 'REVOKED',
          invitedByUserId: owner.id,
          lastSentAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ ...P2002, meta: { target: ['token_hash'] } });
    const index = await db.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'invitation_pending_per_email_key'`;
    expect(index).toHaveLength(1);
    expect(index[0]?.indexdef).toMatch(/WHERE \(status = 'PENDING'/);
  });

  it('GuardianLink is unique per (student, workspace) and GuardianLinkStatus has REFUSED', async () => {
    const db = systemPrisma();
    const owner = await newUser('gl-owner@example.com');
    const student = await newUser('gl-student@example.com');
    const w = await newWorkspace(owner.id, 'ws-gl1');
    const w2 = await newWorkspace(owner.id, 'org-gl2', 'ORGANIZATION');
    const link = (workspaceId: string, status: 'PENDING' | 'REFUSED' = 'PENDING') =>
      db.guardianLink.create({
        data: {
          workspaceId,
          studentUserId: student.id,
          guardianEmail: 'Parent@Example.com',
          status,
        },
      });
    const first = await link(w.id);
    expect(first).toMatchObject({
      guardianUserId: null,
      consentId: null,
      consentTokenHash: null,
      sessionsViewTokenHash: null,
      consentResentCount: 0,
      relationship: null,
    });
    await expect(link(w.id, 'REFUSED')).rejects.toMatchObject(P2002);
    const refused = await link(w2.id, 'REFUSED');
    expect(refused.status).toBe('REFUSED');
    // Secret columns are unique.
    await db.guardianLink.update({
      where: { id: first.id },
      data: { consentTokenHash: 'c1', sessionsViewTokenHash: 's1', relationship: 'PARENT' },
    });
    await expect(
      db.guardianLink.update({ where: { id: refused.id }, data: { consentTokenHash: 'c1' } }),
    ).rejects.toMatchObject(P2002);
    await expect(
      db.guardianLink.update({ where: { id: refused.id }, data: { sessionsViewTokenHash: 's1' } }),
    ).rejects.toMatchObject(P2002);
    // The link points at the guardian's Consent row once granted.
    const consent = await db.consent.create({
      data: {
        userId: student.id,
        workspaceId: w.id,
        type: 'GUARDIAN_PARENTAL',
        version: 'guardian-2026-10',
        granted: true,
        grantedAt: new Date(),
        grantedByEmail: 'parent@example.com',
        ip: '127.0.0.1',
        userAgent: 'vitest',
      },
    });
    const linked = await db.guardianLink.update({
      where: { id: first.id },
      data: { consentId: consent.id, status: 'ACTIVE' },
      include: { consent: true },
    });
    expect(linked.consent?.id).toBe(consent.id);
  });

  it('InviteLink.code is unique; InvitationImport defaults (processedRows 0, status QUEUED)', async () => {
    const db = systemPrisma();
    const owner = await newUser('il-owner@example.com');
    const w = await newWorkspace(owner.id, 'ws-il1');
    const code = {
      workspaceId: w.id,
      code: 'ABCD2345',
      role: 'STUDENT',
      createdByUserId: owner.id,
      requiresApproval: false,
      maxUses: 50,
      status: 'ACTIVE',
    } as const;
    const created = await db.inviteLink.create({ data: code });
    expect(created).toMatchObject({
      usesCount: 0,
      courseIds: [],
      expiresAt: null,
      label: null,
      teacherUserId: null,
    });
    await expect(db.inviteLink.create({ data: code })).rejects.toMatchObject({
      ...P2002,
      meta: { target: ['code'] },
    });

    const imp = await db.invitationImport.create({
      data: {
        workspaceId: w.id,
        createdByUserId: owner.id,
        fileName: 'eleves.csv',
        status: 'QUEUED',
        rows: [{ line: 2, email: 'a@example.com', courseCodes: [] }],
        report: [],
        totalRows: 1,
        validRows: 1,
      },
    });
    expect(imp).toMatchObject({
      status: 'QUEUED',
      processedRows: 0,
      createdCount: 0,
      failedCount: 0,
      error: null,
      startedAt: null,
      finishedAt: null,
    });
  });

  it('deleting a workspace cascades to its invitations, invite links, guardian links and imports', async () => {
    const db = systemPrisma();
    const owner = await newUser('cascade@example.com');
    const student = await newUser('cascade-s@example.com');
    const w = await newWorkspace(owner.id, 'ws-cascade');
    await db.invitation.create({
      data: {
        workspaceId: w.id,
        email: 'x@example.com',
        role: 'STUDENT',
        tokenHash: 'cascade',
        expiresAt: new Date(),
        status: 'PENDING',
        invitedByUserId: owner.id,
        lastSentAt: new Date(),
      },
    });
    await db.inviteLink.create({
      data: {
        workspaceId: w.id,
        code: 'CASCADE2',
        role: 'STUDENT',
        createdByUserId: owner.id,
        requiresApproval: true,
        maxUses: 1,
        status: 'ACTIVE',
      },
    });
    await db.guardianLink.create({
      data: {
        workspaceId: w.id,
        studentUserId: student.id,
        guardianEmail: 'p@example.com',
        status: 'PENDING',
      },
    });
    await db.invitationImport.create({
      data: {
        workspaceId: w.id,
        createdByUserId: owner.id,
        fileName: 'f.csv',
        status: 'QUEUED',
        rows: [],
        report: [],
        totalRows: 0,
        validRows: 0,
      },
    });
    await db.workspace.delete({ where: { id: w.id } });
    expect(
      await Promise.all([
        db.invitation.count(),
        db.inviteLink.count(),
        db.guardianLink.count(),
        db.invitationImport.count(),
      ]),
    ).toEqual([0, 0, 0, 0]);
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

describe.skipIf(!process.env.DATABASE_URL_TEST)('courses & media schema (SP3)', () => {
  beforeEach(() => resetDatabase());

  async function fixture(slug = 'ws-crs1') {
    const db = systemPrisma();
    const owner = await newUser(`${slug}-owner@example.com`);
    const student = await newUser(`${slug}-student@example.com`);
    const ws = await newWorkspace(owner.id, slug);
    const course = await db.course.create({
      data: { workspaceId: ws.id, ownerUserId: owner.id, title: 'Algèbre', language: 'fr' },
    });
    const media = (
      kind: 'VIDEO' | 'PDF' | 'IMAGE' = 'VIDEO',
      extra: { provider?: 'S3' | 'CLOUDFLARE_STREAM'; providerAssetId?: string | null } = {},
    ) =>
      db.mediaAsset.create({
        data: {
          workspaceId: ws.id,
          ownerUserId: owner.id,
          kind,
          provider: extra.provider ?? 'S3',
          providerAssetId: extra.providerAssetId ?? null,
          status: 'READY',
          originalFilename: 'cours.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 1024n,
        },
      });
    const mod = (position: number) =>
      db.module.create({
        data: { workspaceId: ws.id, courseId: course.id, title: `M${position}`, position },
      });
    const enrollment = (
      extra: { progressPercent?: number; source?: 'MANUAL' | 'INVITATION' | 'INVITE_LINK' } = {},
    ) =>
      db.enrollment.create({
        data: {
          workspaceId: ws.id,
          courseId: course.id,
          studentUserId: student.id,
          status: 'ACTIVE',
          assignedByUserId: owner.id,
          source: extra.source ?? 'MANUAL',
          activatedAt: new Date(),
          ...(extra.progressPercent === undefined
            ? {}
            : { progressPercent: extra.progressPercent }),
        },
      });
    const lessonOn = (moduleId: string, position: number, mediaAssetId: string) =>
      db.lesson.create({
        data: { workspaceId: ws.id, moduleId, title: 'L', type: 'VIDEO', position, mediaAssetId },
      });
    return { db, owner, student, ws, course, media, mod, enrollment, lessonOn };
  }

  it('course, module, lesson, media, enrollment and progress defaults', async () => {
    const { db, student, ws, course, media, mod, enrollment } = await fixture();
    expect(course).toMatchObject({
      status: 'DRAFT',
      version: 1,
      sequentialLessons: false,
      isCertifying: false,
      description: null,
      coverMediaId: null,
      level: null,
      estimatedMinutes: null,
      publishedAt: null,
      archivedAt: null,
      deletedAt: null,
      sourceCourseId: null,
    });
    const m = await mod(1);
    expect(m).toMatchObject({ version: 1, isOptional: false, unlockRule: { type: 'NONE' } });
    const asset = await media('PDF');
    expect(asset).toMatchObject({
      countedBytes: 0n,
      failureReason: null,
      uploadId: null,
      storageKey: null,
      deletedAt: null,
    });
    const lesson = await db.lesson.create({
      data: {
        workspaceId: ws.id,
        moduleId: m.id,
        title: 'L1',
        type: 'PDF',
        position: 1,
        mediaAssetId: asset.id,
      },
    });
    expect(lesson).toMatchObject({
      version: 1,
      isRequired: true,
      isPreview: false,
      allowDownload: false,
      content: null,
    });
    expect(await enrollment()).toMatchObject({
      progressPercent: 0,
      completedAt: null,
      revokedAt: null,
    });
    await expect(enrollment({ source: 'INVITATION' })).rejects.toMatchObject(P2002);
    const progress = await db.lessonProgress.create({
      data: { workspaceId: ws.id, lessonId: lesson.id, studentUserId: student.id },
    });
    expect(progress).toMatchObject({
      status: 'NOT_STARTED',
      lastPositionS: 0,
      watchedSegments: [],
      uniqueWatchedS: 0,
      completedManually: false,
      openedAt: null,
      completedAt: null,
    });
    await expect(
      db.lessonProgress.create({
        data: { workspaceId: ws.id, lessonId: lesson.id, studentUserId: student.id },
      }),
    ).rejects.toMatchObject(P2002);
  });

  it('module and lesson positions are DEFERRABLE INITIALLY IMMEDIATE unique constraints', async () => {
    const rows = await systemPrisma().$queryRaw<
      { conname: string; contype: string; deferrable: boolean; deferred: boolean }[]
    >`
      SELECT conname::text, contype::text, condeferrable AS deferrable, condeferred AS deferred
      FROM pg_constraint
      WHERE conname IN ('module_course_position_key', 'lesson_module_position_key')
      ORDER BY 1`;
    expect(rows).toEqual([
      { conname: 'lesson_module_position_key', contype: 'u', deferrable: true, deferred: false },
      { conname: 'module_course_position_key', contype: 'u', deferrable: true, deferred: false },
    ]);
  });

  it('two modules swap positions inside one transaction only with the constraint deferred', async () => {
    const { db, course, mod } = await fixture();
    const m1 = await mod(1);
    const m2 = await mod(2);
    await expect(mod(2)).rejects.toMatchObject(P2002);

    // Row by row without deferral: the first UPDATE collides immediately.
    await expect(
      db.$transaction(async (tx) => {
        await tx.module.update({ where: { id: m1.id }, data: { position: 2 } });
        await tx.module.update({ where: { id: m2.id }, data: { position: 1 } });
      }),
    ).rejects.toMatchObject(P2002);

    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET CONSTRAINTS "module_course_position_key" DEFERRED`;
      await tx.module.update({ where: { id: m1.id }, data: { position: 2 } });
      await tx.module.update({ where: { id: m2.id }, data: { position: 1 } });
    });
    const after = await db.module.findMany({
      where: { courseId: course.id },
      orderBy: { position: 'asc' },
    });
    expect(after.map((m) => m.id)).toEqual([m2.id, m1.id]);

    // Deferred is not disabled: a duplicate left at commit is refused and rolled back.
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
        await tx.module.update({ where: { id: m1.id }, data: { position: 1 } });
      }),
    ).rejects.toMatchObject(P2002);
    expect((await db.module.findUniqueOrThrow({ where: { id: m1.id } })).position).toBe(2);
  });

  it('two lessons swap positions under SET CONSTRAINTS ALL DEFERRED', async () => {
    const { db, ws, mod } = await fixture();
    const m = await mod(1);
    const lesson = (position: number) =>
      db.lesson.create({
        data: {
          workspaceId: ws.id,
          moduleId: m.id,
          title: `L${position}`,
          type: 'TEXT',
          position,
          content: { type: 'doc', content: [] },
        },
      });
    const l1 = await lesson(1);
    const l2 = await lesson(2);
    await expect(lesson(1)).rejects.toMatchObject(P2002);
    await expect(
      db.$transaction(async (tx) => {
        await tx.lesson.update({ where: { id: l1.id }, data: { position: 2 } });
        await tx.lesson.update({ where: { id: l2.id }, data: { position: 1 } });
      }),
    ).rejects.toMatchObject(P2002);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
      await tx.lesson.update({ where: { id: l1.id }, data: { position: 2 } });
      await tx.lesson.update({ where: { id: l2.id }, data: { position: 1 } });
    });
    const after = await db.lesson.findMany({
      where: { moduleId: m.id },
      orderBy: { position: 'asc' },
    });
    expect(after.map((l) => l.id)).toEqual([l2.id, l1.id]);
  });

  it('lesson_content_by_type_check: VIDEO/PDF need a media and no content, TEXT the reverse', async () => {
    const { db, ws, media, mod } = await fixture();
    const m = await mod(1);
    const video = await media('VIDEO');
    let position = 0;
    const lesson = (
      type: 'VIDEO' | 'PDF' | 'TEXT',
      mediaAssetId: string | null,
      content: object | null,
    ) =>
      db.lesson.create({
        data: {
          workspaceId: ws.id,
          moduleId: m.id,
          title: 'L',
          type,
          position: ++position,
          mediaAssetId,
          ...(content ? { content } : {}),
        },
      });
    const check = /lesson_content_by_type_check/;
    const doc = { type: 'doc', content: [] };
    await expect(lesson('VIDEO', null, null)).rejects.toThrow(check);
    await expect(lesson('PDF', null, null)).rejects.toThrow(check);
    await expect(lesson('VIDEO', video.id, doc)).rejects.toThrow(check);
    await expect(lesson('TEXT', video.id, doc)).rejects.toThrow(check);
    await expect(lesson('TEXT', null, null)).rejects.toThrow(check);
    await expect(lesson('VIDEO', video.id, null)).resolves.toBeDefined();
    await expect(lesson('PDF', video.id, null)).resolves.toBeDefined();
    await expect(lesson('TEXT', null, doc)).resolves.toBeDefined();
  });

  it('media_asset_provider_asset_key: unique (provider, provider_asset_id) when set, NULLs allowed', async () => {
    const { media } = await fixture();
    await media('VIDEO', { provider: 'CLOUDFLARE_STREAM', providerAssetId: 'uid-1' });
    await expect(
      media('VIDEO', { provider: 'CLOUDFLARE_STREAM', providerAssetId: 'uid-1' }),
    ).rejects.toMatchObject(P2002);
    await expect(
      media('VIDEO', { provider: 'S3', providerAssetId: 'uid-1' }),
    ).resolves.toBeDefined();
    await expect(media('PDF')).resolves.toBeDefined();
    await expect(media('PDF')).resolves.toBeDefined();
    const index = await systemPrisma().$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'media_asset_provider_asset_key'`;
    expect(index[0]?.indexdef).toMatch(/UNIQUE .*WHERE \(provider_asset_id IS NOT NULL\)/);
  });

  it('enrollment progress_percent is between 0 and 100', async () => {
    const { enrollment } = await fixture();
    const check = /enrollment_progress_percent_check/;
    await expect(enrollment({ progressPercent: 101 })).rejects.toThrow(check);
    await expect(enrollment({ progressPercent: -1 })).rejects.toThrow(check);
    await expect(enrollment({ progressPercent: 100 })).resolves.toBeDefined();
  });

  it('a media referenced by a lesson cannot be deleted; avatar, logo and cover are set to NULL', async () => {
    const { db, owner, ws, course, media, mod, lessonOn } = await fixture();
    const m = await mod(1);
    const video = await media('VIDEO');
    await lessonOn(m.id, 1, video.id);
    await expect(db.mediaAsset.delete({ where: { id: video.id } })).rejects.toThrow();
    const image = await media('IMAGE');
    await db.user.update({ where: { id: owner.id }, data: { avatarMediaId: image.id } });
    await db.workspace.update({ where: { id: ws.id }, data: { logoMediaId: image.id } });
    await db.course.update({ where: { id: course.id }, data: { coverMediaId: image.id } });
    await db.mediaAsset.delete({ where: { id: image.id } });
    const [user, workspace, after] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: owner.id } }),
      db.workspace.findUniqueOrThrow({ where: { id: ws.id } }),
      db.course.findUniqueOrThrow({ where: { id: course.id } }),
    ]);
    expect([user.avatarMediaId, workspace.logoMediaId, after.coverMediaId]).toEqual([
      null,
      null,
      null,
    ]);
    // The avatar now has a real foreign key.
    await expect(
      db.user.update({ where: { id: owner.id }, data: { avatarMediaId: image.id } }),
    ).rejects.toThrow();
  });

  it('deleting a course cascades to modules, lessons, enrollments and progress (media stays)', async () => {
    const { db, student, ws, course, media, mod, enrollment, lessonOn } = await fixture();
    const m = await mod(1);
    const video = await media('VIDEO');
    const lesson = await lessonOn(m.id, 1, video.id);
    await enrollment({ source: 'INVITE_LINK' });
    await db.lessonProgress.create({
      data: { workspaceId: ws.id, lessonId: lesson.id, studentUserId: student.id },
    });
    await db.course.delete({ where: { id: course.id } });
    expect(
      await Promise.all([
        db.module.count(),
        db.lesson.count(),
        db.enrollment.count(),
        db.lessonProgress.count(),
        db.mediaAsset.count(),
      ]),
    ).toEqual([0, 0, 0, 0, 1]);
  });

  it('deleting a workspace cascades to every SP3 tenant table, even with a lesson on a media', async () => {
    const { db, student, ws, course, media, mod, enrollment, lessonOn } = await fixture();
    const m = await mod(1);
    const video = await media('VIDEO');
    await db.course.update({ where: { id: course.id }, data: { coverMediaId: video.id } });
    const lesson = await lessonOn(m.id, 1, video.id);
    await enrollment();
    await db.lessonProgress.create({
      data: { workspaceId: ws.id, lessonId: lesson.id, studentUserId: student.id },
    });
    await db.workspace.delete({ where: { id: ws.id } });
    expect(
      await Promise.all([
        db.course.count(),
        db.module.count(),
        db.lesson.count(),
        db.mediaAsset.count(),
        db.enrollment.count(),
        db.lessonProgress.count(),
      ]),
    ).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('webhook_event is unique per (provider, providerEventId) and not a tenant table', async () => {
    const db = systemPrisma();
    const event = {
      provider: 'cloudflare_stream',
      providerEventId: 'sha256-abc',
      payload: { uid: 'x' },
      signatureValid: true,
    };
    const created = await db.webhookEvent.create({ data: event });
    expect(created).toMatchObject({ processedAt: null, error: null });
    expect(created.receivedAt).toBeInstanceOf(Date);
    await expect(db.webhookEvent.create({ data: event })).rejects.toMatchObject(P2002);
    await expect(
      db.webhookEvent.create({ data: { ...event, provider: 'mux' } }),
    ).resolves.toBeDefined();
    expect(TENANT_MODELS).not.toContain('WebhookEvent');
  });
});
