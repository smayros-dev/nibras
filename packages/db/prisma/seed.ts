/**
 * Demo data for the local dev database — `pnpm db:seed` from the repo root (builds @nibras/db and
 * its workspace dependencies first, then runs this file through Node's type stripping, Node
 * >= 22.18). Local development only: it refuses to run unless `APP_ENV` is unset or
 * `development`, `NODE_ENV` is not `production` and `DATABASE_URL_SYSTEM` points at localhost,
 * 127.0.0.1 or ::1 — any other host (even the compose service `postgres`, which staging shares)
 * needs `SEED_ALLOW_HOST=<that exact host>` (see {@link seedRefusal}).
 *
 * Idempotent: users and workspaces are upserted on their fixed emails/slugs, memberships on
 * their unique keys, consents are skipped when already granted, and the audit/abuse rows only
 * land while the organisation has none. A password hash is rewritten only when it no longer
 * matches the demo password, and then `credentialsVersion` is bumped (open sessions end). Every
 * account (`@example.test`, a reserved TLD) shares the password `mot-de-passe-demo-2026` (HIBP
 * is off locally). The org owner has no 2FA yet, so the first login as them demos the forced
 * `/2fa/setup` flow; the super-admin console needs its own user (`pnpm --filter @nibras/api cli`).
 */
import { PrismaClient } from '@prisma/client';
import {
  CONSENT_VERSIONS,
  defaultWorkspaceSettings,
  type CurrentConsentType,
} from '@nibras/contracts';
import { createS3StorageProviderFromEnv, storageKeyFor } from '@nibras/providers';
import argon2 from 'argon2';
import { seedRefusal } from '../src/seed-guard.ts';
import { uuidv7 } from '../src/uuid.ts';

const refusal = seedRefusal(process.env);
if (refusal) {
  console.error(
    `db:seed refused: ${refusal}. The demo seed only runs against a local dev database.`,
  );
  process.exit(1);
}

const GIB = 1024n ** 3n;
const PASSWORD = 'mot-de-passe-demo-2026';
const TUNIS = 'Africa/Tunis';
const ORG_SLUG = 'academie-el-manar';
const ORG_NAME = 'Académie El Manar';

/** Same costs as the API (PRD §8.1.1): one hash, reused for every demo account. */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
} as const;

interface SeedUser {
  email: string;
  firstName: string;
  lastName: string;
  locale: 'fr' | 'ar' | 'en';
  timezone: string;
  /** Also sets `phoneVerifiedAt` (the verification page's green ticks). */
  phoneE164?: string;
  birthDate?: string;
  /** Creates `Espace de {firstName}` with an ACTIVE OWNER membership. */
  personal?: boolean;
  /** Account consents on top of the registration default (TERMS + PRIVACY). */
  consents?: CurrentConsentType[];
}

const USERS: SeedUser[] = [
  {
    email: 'amine@example.test',
    firstName: 'Amine',
    lastName: 'Haddad',
    locale: 'fr',
    timezone: TUNIS,
    phoneE164: '+21622345678',
    personal: true,
    consents: ['CODE_OF_CONDUCT'],
  },
  {
    email: 'leila@example.test',
    firstName: 'Leila',
    lastName: 'Bouzid',
    locale: 'fr',
    timezone: TUNIS,
    personal: true,
    consents: ['MARKETING'],
  },
  {
    email: 'karim@example.test',
    firstName: 'Karim',
    lastName: 'Trabelsi',
    locale: 'fr',
    timezone: 'Europe/Paris',
    personal: true,
  },
  {
    email: 'sana@example.test',
    firstName: 'Sana',
    lastName: 'Mansour',
    locale: 'ar',
    timezone: TUNIS,
    personal: true,
  },
  {
    email: 'rajaa@example.test',
    firstName: 'Rajaa',
    lastName: 'Gharbi',
    locale: 'fr',
    timezone: TUNIS,
    personal: true,
  },
  {
    email: 'yassine@example.test',
    firstName: 'Yassine',
    lastName: 'Gharbi',
    locale: 'fr',
    timezone: TUNIS,
    birthDate: '2015-06-15',
  },
  {
    email: 'noussa@example.test',
    firstName: 'Noussa',
    lastName: 'Trabelsi',
    locale: 'fr',
    timezone: TUNIS,
    birthDate: '2001-09-20',
  },
  // STUDENT left in SUSPENDED_NO_CONSENT (no guardian consent yet) — shows the members status variety.
  {
    email: 'tarek@example.test',
    firstName: 'Tarek',
    lastName: 'Zouari',
    locale: 'fr',
    timezone: TUNIS,
    birthDate: '2016-01-01',
  },
];

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_SYSTEM } },
});

/** Registration grants these two (see the API's register flow); the rest are explicit above. */
const DEFAULT_CONSENTS: CurrentConsentType[] = ['TERMS', 'PRIVACY'];

async function grantConsents(userId: string, types: CurrentConsentType[]): Promise<void> {
  if (types.length === 0) return;
  const held = await prisma.consent.findMany({
    where: {
      userId,
      workspaceId: null,
      granted: true,
      revokedAt: null,
      OR: types.map((type) => ({ type, version: CONSENT_VERSIONS[type] })),
    },
    select: { type: true },
  });
  const missing = types.filter((type) => !held.some((c) => c.type === type));
  if (missing.length === 0) return;
  const now = new Date();
  await prisma.consent.createMany({
    data: missing.map((type) => ({
      userId,
      type,
      version: CONSENT_VERSIONS[type],
      granted: true,
      grantedAt: now,
      ip: '127.0.0.1',
      userAgent: 'seed',
    })),
  });
}

/**
 * A one-page PDF (Helvetica text, computed xref offsets) for the demo course's PDF lesson: small,
 * valid for pdf.js and for the API's `%PDF-` signature check.
 */
function demoPdf(): Buffer {
  const text =
    'BT /F1 22 Tf 72 760 Td (Mathematiques Niveau 1 - Fiche d exercices) Tj ET\n' +
    'BT /F1 14 Tf 72 720 Td (1. Calculez 12 + 30.   2. Simplifiez 6/8.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/**
 * Upload the demo PDF to the dev bucket (`S3_*`, MinIO) through `S3StorageProvider` (one-part
 * multipart, as the browser does) and record it as a `READY` asset counted in the workspace
 * quota. `null` with a warning when the object store is unreachable or not configured.
 */
async function seedDemoPdf(workspaceId: string, ownerUserId: string): Promise<string | null> {
  const bytes = demoPdf();
  const mediaId = uuidv7();
  const filename = 'fiche-exercices.pdf';
  const key = storageKeyFor({ workspaceId, kind: 'PDF', mediaId, filename });
  try {
    const storage = createS3StorageProviderFromEnv(process.env);
    const { uploadId } = await storage.createMultipartUpload(key, 'application/pdf');
    const url = await storage.signPartUrl(key, uploadId, 1, 300);
    const put = await fetch(url, { method: 'PUT', body: bytes });
    const etag = put.headers.get('etag');
    if (!put.ok || !etag) throw new Error(`PUT ${put.status}`);
    await storage.completeMultipart(key, uploadId, [{ partNumber: 1, etag, size: bytes.length }]);
  } catch (error) {
    console.warn(
      `db:seed: object store unreachable (${(error as Error).message}): the demo course has no PDF lesson. Start MinIO, run \`pnpm --filter @nibras/api s3:init\`, then seed again.`,
    );
    return null;
  }
  const size = BigInt(bytes.length);
  await prisma.$transaction([
    prisma.mediaAsset.create({
      data: {
        id: mediaId,
        workspaceId,
        ownerUserId,
        kind: 'PDF',
        provider: 'S3',
        storageKey: key,
        status: 'READY',
        originalFilename: filename,
        mimeType: 'application/pdf',
        sizeBytes: size,
        pageCount: 1,
        readyAt: new Date(),
        countedBytes: size,
      },
    }),
    prisma.workspace.update({
      where: { id: workspaceId },
      data: { storageUsedBytes: { increment: size } },
    }),
  ]);
  return mediaId;
}

const DEMO_COURSE = 'Mathématiques Niveau 1';

/** A document of plain paragraphs (rich-text whitelist). */
function paragraphs(...texts: string[]) {
  return {
    type: 'doc',
    content: texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  };
}

/**
 * The demo course (SP3): « Mathématiques Niveau 1 » by Leila in the organisation, published, two
 * modules (the second opens once the first is complete), a TEXT lesson each and a PDF lesson whose
 * object is uploaded to MinIO; Yassine and Noussa are enrolled. Idempotent: found by title and
 * owner; the PDF lesson is added on a later run if the object store was down the first time.
 */
async function seedDemoCourse(
  workspaceId: string,
  ownerUserId: string,
  studentIds: string[],
): Promise<void> {
  const now = new Date();
  let course = await prisma.course.findFirst({
    where: { workspaceId, ownerUserId, title: DEMO_COURSE, deletedAt: null },
    select: { id: true },
  });
  if (!course) {
    course = await prisma.course.create({
      data: {
        workspaceId,
        ownerUserId,
        title: DEMO_COURSE,
        description: paragraphs(
          'Les bases du collège : nombres entiers, fractions et premières équations.',
        ),
        level: 'COLLEGE',
        language: 'fr',
        status: 'PUBLISHED',
        publishedAt: now,
        modules: {
          create: [
            {
              workspaceId,
              title: 'Les nombres',
              position: 1,
              lessons: {
                create: [
                  {
                    workspaceId,
                    title: 'Les nombres entiers',
                    type: 'TEXT',
                    position: 1,
                    estimatedMinutes: 10,
                    content: paragraphs(
                      'Un nombre entier est un nombre sans partie décimale : 0, 1, 2, 3…',
                      'On peut les additionner, les soustraire et les multiplier.',
                    ),
                  },
                ],
              },
            },
            {
              workspaceId,
              title: 'Les fractions',
              position: 2,
              unlockRule: { type: 'PREVIOUS_MODULE_COMPLETED' },
              lessons: {
                create: [
                  {
                    workspaceId,
                    title: 'Qu’est-ce qu’une fraction ?',
                    type: 'TEXT',
                    position: 1,
                    estimatedMinutes: 15,
                    content: paragraphs('Une fraction partage une unité en parts égales : 3/4.'),
                  },
                ],
              },
            },
          ],
        },
      },
      select: { id: true },
    });
  }

  const first = await prisma.module.findFirst({
    where: { courseId: course.id, position: 1 },
    select: { id: true, lessons: { select: { type: true, position: true } } },
  });
  if (first && !first.lessons.some((l) => l.type === 'PDF')) {
    const pdfId = await seedDemoPdf(workspaceId, ownerUserId);
    if (pdfId) {
      await prisma.$transaction([
        prisma.lesson.create({
          data: {
            workspaceId,
            moduleId: first.id,
            title: 'Fiche d’exercices',
            type: 'PDF',
            position: Math.max(0, ...first.lessons.map((l) => l.position)) + 1,
            mediaAssetId: pdfId,
            allowDownload: true,
          },
        }),
        prisma.course.update({ where: { id: course.id }, data: { version: { increment: 1 } } }),
        prisma.module.update({ where: { id: first.id }, data: { version: { increment: 1 } } }),
      ]);
    }
  }

  for (const studentUserId of studentIds) {
    await prisma.enrollment.upsert({
      where: { courseId_studentUserId: { courseId: course.id, studentUserId } },
      update: {},
      create: {
        workspaceId,
        courseId: course.id,
        studentUserId,
        status: 'ACTIVE',
        assignedByUserId: ownerUserId,
        source: 'MANUAL',
        activatedAt: now,
      },
    });
  }
}

async function main(): Promise<void> {
  const passwordHash = await argon2.hash(PASSWORD.normalize('NFKC'), ARGON2_OPTIONS);
  const now = new Date();
  const lastLogin = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const ids = new Map<string, string>();
  for (const u of USERS) {
    // Re-run: keep a hash that still matches (sessions stay valid); a rewritten hash bumps
    // `credentialsVersion`, which ends every session issued on the previous credentials.
    const existing = await prisma.user.findUnique({
      where: { email: u.email },
      select: { passwordHash: true },
    });
    const hashMatches =
      existing?.passwordHash != null &&
      (await argon2.verify(existing.passwordHash, PASSWORD.normalize('NFKC')).catch(() => false));
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        firstName: u.firstName,
        lastName: u.lastName,
        locale: u.locale,
        timezone: u.timezone,
        ...(!hashMatches && { passwordHash, credentialsVersion: { increment: 1 } }),
        emailVerifiedAt: now,
        lastLoginAt: lastLogin,
        ...(u.phoneE164 && { phoneE164: u.phoneE164, phoneVerifiedAt: now }),
        ...(u.birthDate && { birthDate: new Date(`${u.birthDate}T00:00:00Z`) }),
      },
      create: {
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        locale: u.locale,
        timezone: u.timezone,
        passwordHash,
        emailVerifiedAt: now,
        lastLoginAt: lastLogin,
        ...(u.phoneE164 && { phoneE164: u.phoneE164, phoneVerifiedAt: now }),
        ...(u.birthDate && { birthDate: new Date(`${u.birthDate}T00:00:00Z`) }),
      },
    });
    ids.set(u.email, user.id);
    await grantConsents(user.id, [...DEFAULT_CONSENTS, ...(u.consents ?? [])]);
  }

  // A revoked MARKETING consent on the owner, so the consents page shows history too.
  const amineId = ids.get('amine@example.test')!;
  const revokedMarketing = await prisma.consent.findFirst({
    where: { userId: amineId, type: 'MARKETING', revokedAt: { not: null } },
    select: { id: true },
  });
  if (!revokedMarketing) {
    await prisma.consent.create({
      data: {
        userId: amineId,
        type: 'MARKETING',
        version: CONSENT_VERSIONS.MARKETING,
        granted: true,
        grantedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        revokedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
        ip: '127.0.0.1',
        userAgent: 'seed',
      },
    });
  }

  // PERSONAL workspaces (what registration creates): `Espace de {prénom}`, 20 GiB.
  for (const u of USERS) {
    if (!u.personal) continue;
    const userId = ids.get(u.email)!;
    const slug = `espace-de-${u.firstName.toLowerCase()}`;
    const personal = await prisma.workspace.upsert({
      where: { slug },
      update: { name: `Espace de ${u.firstName}`, ownerUserId: userId },
      create: {
        type: 'PERSONAL',
        name: `Espace de ${u.firstName}`,
        slug,
        ownerUserId: userId,
        defaultTimezone: u.timezone,
        defaultLocale: u.locale,
        storageQuotaBytes: 20n * GIB,
        settings: { ...defaultWorkspaceSettings(u.timezone) },
      },
    });
    await prisma.membership.upsert({
      where: { workspaceId_userId: { workspaceId: personal.id, userId } },
      update: { role: 'OWNER', status: 'ACTIVE', joinedAt: now },
      create: { workspaceId: personal.id, userId, role: 'OWNER', status: 'ACTIVE', joinedAt: now },
    });
  }

  // The demo organisation (200 GiB, TN) and its memberships.
  const org = await prisma.workspace.upsert({
    where: { slug: ORG_SLUG },
    update: { name: ORG_NAME, ownerUserId: amineId },
    create: {
      type: 'ORGANIZATION',
      name: ORG_NAME,
      slug: ORG_SLUG,
      country: 'TN',
      ownerUserId: amineId,
      defaultTimezone: TUNIS,
      defaultLocale: 'fr',
      storageQuotaBytes: 200n * GIB,
      settings: { ...defaultWorkspaceSettings(TUNIS) },
    },
  });

  const orgMembers: {
    email: string;
    role: 'OWNER' | 'TEACHER' | 'ASSISTANT' | 'STUDENT' | 'GUARDIAN';
    status?: 'ACTIVE' | 'SUSPENDED_NO_CONSENT';
  }[] = [
    { email: 'amine@example.test', role: 'OWNER' },
    { email: 'leila@example.test', role: 'TEACHER' },
    { email: 'karim@example.test', role: 'TEACHER' },
    { email: 'sana@example.test', role: 'ASSISTANT' },
    { email: 'rajaa@example.test', role: 'GUARDIAN' },
    { email: 'yassine@example.test', role: 'STUDENT' },
    { email: 'noussa@example.test', role: 'STUDENT' },
    { email: 'tarek@example.test', role: 'STUDENT', status: 'SUSPENDED_NO_CONSENT' },
  ];
  // One OWNER per workspace (`membership_owner_per_workspace_key`): if ownership was transferred
  // since the last seed, demote that OWNER before Amine is made OWNER again.
  await prisma.membership.updateMany({
    where: { workspaceId: org.id, role: 'OWNER', userId: { not: amineId } },
    data: { role: 'ADMIN' },
  });
  for (const m of orgMembers) {
    const userId = ids.get(m.email)!;
    const status = m.status ?? 'ACTIVE';
    await prisma.membership.upsert({
      where: { workspaceId_userId: { workspaceId: org.id, userId } },
      update: { role: m.role, status },
      create: {
        workspaceId: org.id,
        userId,
        role: m.role,
        status,
        joinedAt: status === 'ACTIVE' ? now : null,
        invitedByUserId: m.role === 'OWNER' ? null : amineId,
      },
    });
  }

  // Teacher ↔ student assignments (the members page's assignment list).
  const assignments: [string, string][] = [
    ['leila@example.test', 'yassine@example.test'],
    ['karim@example.test', 'noussa@example.test'],
  ];
  for (const [teacherEmail, studentEmail] of assignments) {
    await prisma.teacherStudentAssignment.upsert({
      where: {
        workspaceId_teacherUserId_studentUserId: {
          workspaceId: org.id,
          teacherUserId: ids.get(teacherEmail)!,
          studentUserId: ids.get(studentEmail)!,
        },
      },
      update: {},
      create: {
        workspaceId: org.id,
        teacherUserId: ids.get(teacherEmail)!,
        studentUserId: ids.get(studentEmail)!,
        assignedByUserId: amineId,
      },
    });
  }

  const profiles: [string, string[], string][] = [
    [
      'leila@example.test',
      ['Mathématiques', 'Physique'],
      'Professeure de mathématiques et de physique, 12 ans d’expérience au lycée.',
    ],
    [
      'karim@example.test',
      ['Anglais'],
      'Professeur d’anglais, préparation aux examens internationaux.',
    ],
  ];
  for (const [email, subjects, bio] of profiles) {
    await prisma.teacherProfile.upsert({
      where: { workspaceId_userId: { workspaceId: org.id, userId: ids.get(email)! } },
      update: { subjects, bio },
      create: { workspaceId: org.id, userId: ids.get(email)!, subjects, bio },
    });
  }

  // Audit history for the organisation's audit-log page (append-only: only while empty).
  const auditCount = await prisma.auditLog.count({ where: { workspaceId: org.id } });
  if (auditCount === 0) {
    const hour = 60 * 60 * 1000;
    const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * hour);
    await prisma.auditLog.createMany({
      data: [
        {
          workspaceId: org.id,
          actorUserId: amineId,
          actorRole: 'OWNER',
          action: 'workspace.created',
          entityType: 'Workspace',
          entityId: org.id,
          after: { name: ORG_NAME, type: 'ORGANIZATION' },
          requestId: 'seed:1',
          createdAt: at(72),
        },
        {
          workspaceId: org.id,
          actorUserId: amineId,
          actorRole: 'OWNER',
          action: 'member.added',
          entityType: 'Membership',
          entityId: ids.get('leila@example.test'),
          after: { role: 'TEACHER', status: 'ACTIVE' },
          requestId: 'seed:2',
          createdAt: at(71),
        },
        {
          workspaceId: org.id,
          actorUserId: amineId,
          actorRole: 'OWNER',
          action: 'member.added',
          entityType: 'Membership',
          entityId: ids.get('yassine@example.test'),
          after: { role: 'STUDENT', status: 'ACTIVE' },
          requestId: 'seed:3',
          createdAt: at(70),
        },
        {
          workspaceId: org.id,
          actorUserId: amineId,
          actorRole: 'OWNER',
          action: 'member.added',
          entityType: 'Membership',
          entityId: ids.get('rajaa@example.test'),
          after: { role: 'GUARDIAN', status: 'ACTIVE' },
          requestId: 'seed:4',
          createdAt: at(69),
        },
        {
          workspaceId: org.id,
          actorUserId: amineId,
          actorRole: 'OWNER',
          action: 'member.role_changed',
          entityType: 'Membership',
          entityId: ids.get('sana@example.test'),
          before: { role: 'TEACHER' },
          after: { role: 'ASSISTANT' },
          requestId: 'seed:5',
          createdAt: at(48),
        },
        {
          workspaceId: org.id,
          actorUserId: amineId,
          actorRole: 'OWNER',
          action: 'member.added',
          entityType: 'Membership',
          entityId: ids.get('tarek@example.test'),
          after: { role: 'STUDENT', status: 'SUSPENDED_NO_CONSENT' },
          requestId: 'seed:6',
          createdAt: at(24),
        },
      ],
    });
  }

  // Two abuse reports (the admin console queue + the members page report flow).
  const abuseCount = await prisma.abuseReport.count({ where: { workspaceId: org.id } });
  if (abuseCount === 0) {
    await prisma.abuseReport.createMany({
      data: [
        {
          workspaceId: org.id,
          reporterUserId: ids.get('leila@example.test')!,
          category: 'HARASSMENT',
          description:
            'Démo : messages inappropriés envers d’autres membres (signalement de test).',
          entityType: 'USER',
          entityId: ids.get('tarek@example.test')!,
          contextSnapshot: {
            kind: 'seed',
            reported: { email: 'tarek@example.test', firstName: 'Tarek' },
          },
          status: 'OPEN',
        },
        {
          workspaceId: org.id,
          reporterUserId: ids.get('karim@example.test')!,
          category: 'MINOR_SAFETY',
          description: 'Démo : signalement sécurité mineur (toujours prioritaire dans la file).',
          entityType: 'USER',
          entityId: ids.get('tarek@example.test')!,
          contextSnapshot: {
            kind: 'seed',
            reported: { email: 'tarek@example.test', birthDate: '2016-01-01' },
          },
          status: 'IN_REVIEW',
        },
      ],
    });
  }

  await seedDemoCourse(org.id, ids.get('leila@example.test')!, [
    ids.get('yassine@example.test')!,
    ids.get('noussa@example.test')!,
  ]);

  console.log(
    `Seed OK — ${USERS.length} users, organisation « ${ORG_NAME} » (${org.slug}), cours « ${DEMO_COURSE} ».`,
  );
  console.log(
    `Connexion démo (mot de passe ${PASSWORD}) : ${USERS.map((u) => u.email).join(', ')}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
