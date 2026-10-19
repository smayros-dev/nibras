import { randomBytes } from 'node:crypto';
import {
  CONSENT_VERSIONS,
  GUARDIAN_CONSENT_TTL_MS,
  GUARDIAN_CONSENT_VERSION,
  INVITATION_TTL_MS,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  INVITE_LINK_DEFAULT_MAX_USES,
  INVITE_LINK_DEFAULT_TTL_DAYS,
  defaultWorkspaceSettings,
  generateOpaqueToken,
  isMinor,
  type CurrentConsentType,
} from '@nibras/contracts';
import {
  systemPrisma,
  uuidv7,
  type GuardianLink,
  type GuardianLinkStatus,
  type ImportStatus,
  type Invitation,
  type InvitationImport,
  type InvitationStatus,
  type InviteLink,
  type InviteLinkStatus,
  type Locale,
  type Membership,
  type MembershipRole,
  type MembershipStatus,
  type PlatformRole,
  type TeacherStudentAssignment,
  type User,
  type UserStatus,
  type Workspace,
} from '@nibras/db';
import { hashPassword } from '../../src/auth/crypto/password';
import { SecretBox } from '../../src/auth/crypto/secret-box';
import { env } from '../../src/config/env';

/**
 * Test fixtures written through `systemPrisma()` (`app_system`, BYPASSRLS) on this package's test
 * database: they set up state directly, never through the API's tenancy guards.
 */

export const DEFAULT_PASSWORD = 'correct horse battery staple';

const GIB = 1024n ** 3n;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** `n` random lowercase base32 characters. */
function randomBase32(n: number): string {
  return Array.from(randomBytes(n), (b) => BASE32[b % 32]).join('');
}

/**
 * argon2id costs 64 MiB and ~100 ms per hash: each distinct password is hashed once per process
 * (fixtures share the salt; real hashes never do).
 */
const hashes = new Map<string, Promise<string>>();
function cachedHash(password: string): Promise<string> {
  let hash = hashes.get(password);
  if (!hash) {
    hash = hashPassword(password);
    hashes.set(password, hash);
  }
  return hash;
}

export interface CreateUserOptions {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  locale: Locale;
  timezone: string;
  /** Default `true`. */
  emailVerified: boolean;
  /** Default `false`; `true` also sets a phone number. */
  phoneVerified: boolean;
  platformRole: PlatformRole;
  status: UserStatus;
  /** Base32 TOTP seed: stored sealed with `TOTP_ENCRYPTION_KEY`, 2FA enabled. */
  totpSecret: string;
  /**
   * Account-level consents granted at their current versions. Default `['TERMS', 'PRIVACY']`
   * (what registration grants), so the user clears the consents gate; `[]` for none.
   */
  consents: CurrentConsentType[];
  /** `YYYY-MM-DD`; default none (SP1 users have no birth date). */
  birthDate: string;
}

/**
 * A user with a verified email, TERMS + PRIVACY accepted at their current versions and the
 * password `'correct horse battery staple'` by default.
 */
export async function createUser(
  o: Partial<CreateUserOptions> = {},
): Promise<User & { password: string }> {
  const password = o.password ?? DEFAULT_PASSWORD;
  const now = new Date();
  const user = await systemPrisma().user.create({
    data: {
      email: o.email ?? `user-${uuidv7()}@example.com`,
      passwordHash: await cachedHash(password),
      firstName: o.firstName ?? 'Test',
      lastName: o.lastName ?? 'User',
      locale: o.locale ?? 'fr',
      timezone: o.timezone ?? 'Africa/Tunis',
      emailVerifiedAt: (o.emailVerified ?? true) ? now : null,
      ...(o.phoneVerified && { phoneE164: '+21620000000', phoneVerifiedAt: now }),
      platformRole: o.platformRole ?? 'NONE',
      status: o.status ?? 'ACTIVE',
      ...(o.birthDate !== undefined && { birthDate: dateOnly(o.birthDate) }),
      ...(o.totpSecret !== undefined && {
        totpSecretEnc: new SecretBox(env.TOTP_ENCRYPTION_KEY).seal(o.totpSecret),
        totpEnabledAt: now,
      }),
    },
  });
  await grantConsents(user, o.consents ?? ['TERMS', 'PRIVACY']);
  return { ...user, password };
}

export interface CreateWorkspaceOptions {
  name: string;
  slug: string;
  status: Workspace['status'];
  /** Stored with `suspendedAt = now` when `status` is `SUSPENDED`. */
  suspendedReason: string;
}

async function createWorkspace(
  type: Workspace['type'],
  owner: User,
  name: string,
  o: Partial<CreateWorkspaceOptions> & { allowPersonalWorkspaces?: boolean },
): Promise<Workspace> {
  return systemPrisma().workspace.create({
    data: {
      id: uuidv7(),
      type,
      name: o.name ?? name,
      slug: o.slug ?? `ws-${randomBase32(6)}-${randomBase32(6)}`,
      status: o.status ?? 'ACTIVE',
      ...(o.status === 'SUSPENDED' && {
        suspendedAt: new Date(),
        suspendedReason: o.suspendedReason ?? null,
      }),
      ...(o.status === 'DELETING' && { deletedAt: new Date() }),
      ownerUserId: owner.id,
      defaultTimezone: owner.timezone,
      defaultLocale: owner.locale,
      storageQuotaBytes: (type === 'PERSONAL' ? 20n : 200n) * GIB,
      settings: { ...defaultWorkspaceSettings(owner.timezone) },
      ...(o.allowPersonalWorkspaces !== undefined && {
        allowPersonalWorkspaces: o.allowPersonalWorkspaces,
      }),
    },
  });
}

export interface AddMemberOptions {
  /** Default `ACTIVE`. */
  status: MembershipStatus;
  /** Default `false` (ADMIN who also teaches). */
  canTeach: boolean;
  /** Default `null`. */
  invitedByUserId: string;
}

/** A membership of `user` in `workspace` (ACTIVE, `canTeach = false` by default). */
export function addMember(
  workspace: Pick<Workspace, 'id'>,
  user: Pick<User, 'id'>,
  role: MembershipRole,
  o: Partial<AddMemberOptions> = {},
): Promise<Membership> {
  const status = o.status ?? 'ACTIVE';
  const now = new Date();
  return systemPrisma().membership.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role,
      status,
      canTeach: o.canTeach ?? false,
      invitedByUserId: o.invitedByUserId ?? null,
      joinedAt: status === 'ACTIVE' ? now : null,
      ...(status === 'REMOVED' && { removedAt: now }),
    },
  });
}

/** A teacher ↔ student assignment (assigned by the teacher unless `assignedBy` is given). */
export function assign(
  workspace: Pick<Workspace, 'id'>,
  teacher: Pick<User, 'id'>,
  student: Pick<User, 'id'>,
  assignedBy: Pick<User, 'id'> = teacher,
): Promise<TeacherStudentAssignment> {
  return systemPrisma().teacherStudentAssignment.create({
    data: {
      workspaceId: workspace.id,
      teacherUserId: teacher.id,
      studentUserId: student.id,
      assignedByUserId: assignedBy.id,
    },
  });
}

/** A PERSONAL workspace (`Espace de {prénom}`, 20 GiB) with its ACTIVE OWNER membership. */
export async function createPersonalWorkspace(
  owner: User,
  o: Partial<CreateWorkspaceOptions> = {},
): Promise<Workspace> {
  const workspace = await createWorkspace('PERSONAL', owner, `Espace de ${owner.firstName}`, o);
  await addMember(workspace, owner, 'OWNER');
  return workspace;
}

/**
 * An ORGANIZATION (200 GiB) with ACTIVE memberships, returned in the order owner, admins,
 * teachers, students.
 */
export async function createOrganization(o: {
  owner: User;
  admins?: User[];
  teachers?: User[];
  students?: User[];
  /** Any other membership (role, status, `canTeach`), created after the lists above. */
  members?: ({ user: User; role: MembershipRole } & Partial<AddMemberOptions>)[];
  allowPersonalWorkspaces?: boolean;
  name?: string;
  /** Default `ACTIVE`. */
  status?: Workspace['status'];
  suspendedReason?: string;
}): Promise<{ workspace: Workspace; memberships: Membership[] }> {
  const workspace = await createWorkspace('ORGANIZATION', o.owner, o.name ?? 'Organisation test', {
    allowPersonalWorkspaces: o.allowPersonalWorkspaces,
    status: o.status,
    suspendedReason: o.suspendedReason,
  });
  const members: ({ user: User; role: MembershipRole } & Partial<AddMemberOptions>)[] = [
    { user: o.owner, role: 'OWNER' },
    ...(o.admins ?? []).map((user) => ({ user, role: 'ADMIN' as const })),
    ...(o.teachers ?? []).map((user) => ({ user, role: 'TEACHER' as const })),
    ...(o.students ?? []).map((user) => ({ user, role: 'STUDENT' as const })),
    ...(o.members ?? []),
  ];
  const memberships: Membership[] = [];
  for (const { user, role, ...opts } of members) {
    memberships.push(await addMember(workspace, user, role, opts));
  }
  return { workspace, memberships };
}

/**
 * Account-level consents granted at their current `CONSENT_VERSIONS`. Idempotent like
 * `POST /me/consents/{type}`: a type already granted (unrevoked) at its current version is
 * skipped, so `grantConsents(await createUser())` leaves one row per type.
 */
export async function grantConsents(
  user: Pick<User, 'id'>,
  types: CurrentConsentType[] = ['TERMS', 'PRIVACY'],
): Promise<void> {
  if (types.length === 0) return;
  const held = await systemPrisma().consent.findMany({
    where: {
      userId: user.id,
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
  await systemPrisma().consent.createMany({
    data: missing.map((type) => ({
      userId: user.id,
      type,
      version: CONSENT_VERSIONS[type],
      granted: true,
      grantedAt: now,
      ip: '127.0.0.1',
      userAgent: 'factory',
    })),
  });
}

// ---------------------------------------------------------------------------------------------
// SP2: students, invitations, invite links, guardian links, imports.
// ---------------------------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` → the `@db.Date` value Prisma stores (UTC midnight). */
function dateOnly(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** The UTC calendar date `years` years before `now`, as `YYYY-MM-DD`. */
export function birthDateYearsAgo(years: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/** A 12-year-old's birth date (a minor under `MINOR_AGE_THRESHOLD`). */
export const minorBirthDate = (): string => birthDateYearsAgo(12);
/** A 25-year-old's birth date. */
export const adultBirthDate = (): string => birthDateYearsAgo(25);

export interface CreateGuardianLinkOptions {
  workspace: Pick<Workspace, 'id'>;
  student: Pick<User, 'id'>;
  status: GuardianLinkStatus;
  /** Default `guardian-{uuid}@example.com`. */
  guardianEmail?: string;
  /** PENDING only: default now + `GUARDIAN_CONSENT_TTL_MS` (a past date makes it expired). */
  consentExpiresAt?: Date;
}

/**
 * The guardian link of (`student`, `workspace`), written directly (no audit, no email):
 * - `PENDING`: a live 14-day consent token (`consentToken` raw, for the public consent page);
 * - `ACTIVE`: an unrevoked `GUARDIAN_PARENTAL` consent for the workspace and a guardian page token
 *   (`pageToken` raw);
 * - `REVOKED`: the same consent, revoked, and a guardian page token (re-grant stays possible);
 * - `REFUSED`: decided, no consent row and no token.
 */
export async function createGuardianLink(
  o: CreateGuardianLinkOptions,
): Promise<{ link: GuardianLink; consentToken?: string; pageToken?: string }> {
  const db = systemPrisma();
  const now = new Date();
  const guardianEmail = o.guardianEmail ?? `guardian-${uuidv7()}@example.com`;
  const base = {
    workspaceId: o.workspace.id,
    studentUserId: o.student.id,
    guardianEmail,
    status: o.status,
    consentSentAt: now,
  };

  if (o.status === 'PENDING') {
    const consent = generateOpaqueToken();
    const link = await db.guardianLink.create({
      data: {
        ...base,
        consentTokenHash: consent.hash,
        consentExpiresAt: o.consentExpiresAt ?? new Date(now.getTime() + GUARDIAN_CONSENT_TTL_MS),
      },
    });
    return { link, consentToken: consent.raw };
  }
  if (o.status === 'REFUSED') {
    return { link: await db.guardianLink.create({ data: { ...base, decidedAt: now } }) };
  }

  const revokedAt = o.status === 'REVOKED' ? now : null;
  const consentRow = await db.consent.create({
    data: {
      userId: o.student.id,
      grantedByEmail: guardianEmail,
      type: 'GUARDIAN_PARENTAL',
      version: GUARDIAN_CONSENT_VERSION,
      granted: true,
      grantedAt: now,
      revokedAt,
      ip: '127.0.0.1',
      userAgent: 'factory',
      workspaceId: o.workspace.id,
    },
  });
  const page = generateOpaqueToken();
  const link = await db.guardianLink.create({
    data: {
      ...base,
      consentId: consentRow.id,
      sessionsViewTokenHash: page.hash,
      decidedAt: now,
      revokedAt,
    },
  });
  return { link, pageToken: page.raw };
}

export interface CreateStudentOptions {
  workspace: Pick<Workspace, 'id'>;
  /** Default `ACTIVE`. */
  status?: MembershipStatus;
  /** Default `false`; `true` gives a 12-year-old's birth date unless `birthDate` is set. */
  minor?: boolean;
  /** `YYYY-MM-DD`; default a 25-year-old's (a 12-year-old's with `minor`). */
  birthDate?: string;
  invitedBy?: Pick<User, 'id'>;
  guardianEmail?: string;
  /**
   * The minor's guardian link status. Default from the membership: `ACTIVE` → `ACTIVE`,
   * `SUSPENDED_CONSENT_REVOKED` → `REVOKED`, any other → `PENDING`.
   */
  guardianStatus?: GuardianLinkStatus;
  /** Extra user fields (email, names, locale…). */
  user?: Partial<Omit<CreateUserOptions, 'birthDate'>>;
}

/**
 * A STUDENT of `workspace` with a birth date. A minor (today, `isMinor`) also gets the guardian
 * link of that workspace (see {@link createGuardianLink}); an `ACTIVE` minor always holds an
 * unrevoked consent, so the fixture never breaks `expectMinorInvariant`.
 */
export async function createStudent(o: CreateStudentOptions): Promise<{
  user: User & { password: string };
  membership: Membership;
  guardianLink?: GuardianLink;
  consentToken?: string;
  pageToken?: string;
}> {
  const status = o.status ?? 'ACTIVE';
  const birthDate = o.birthDate ?? (o.minor ? minorBirthDate() : adultBirthDate());
  const user = await createUser({ ...o.user, birthDate });
  const membership = await addMember(o.workspace, user, 'STUDENT', {
    status,
    ...(o.invitedBy && { invitedByUserId: o.invitedBy.id }),
  });
  if (!isMinor(birthDate)) return { user, membership };

  const defaultStatus: GuardianLinkStatus =
    status === 'ACTIVE' ? 'ACTIVE' : status === 'SUSPENDED_CONSENT_REVOKED' ? 'REVOKED' : 'PENDING';
  const g = await createGuardianLink({
    workspace: o.workspace,
    student: user,
    status: o.guardianStatus ?? defaultStatus,
    guardianEmail: o.guardianEmail,
  });
  return {
    user,
    membership,
    guardianLink: g.link,
    consentToken: g.consentToken,
    pageToken: g.pageToken,
  };
}

export interface CreateInvitationOptions {
  workspace: Pick<Workspace, 'id'>;
  invitedBy: Pick<User, 'id'>;
  /** Default `invitee-{uuid}@example.com`. */
  email?: string;
  /** Default `STUDENT`. */
  role?: MembershipRole;
  /** Default `PENDING`. */
  status?: InvitationStatus;
  /** Default now + `INVITATION_TTL_MS` (a past date makes it expired). */
  expiresAt?: Date;
  guardianEmail?: string;
  /** `YYYY-MM-DD`. */
  birthDate?: string;
  firstName?: string;
  lastName?: string;
  message?: string;
  teacherUserId?: string;
  /** `ACCEPTED` only. */
  acceptedBy?: Pick<User, 'id'>;
}

/** An email invitation written directly (no audit, no email); `token` is the raw link token. */
export async function createInvitation(
  o: CreateInvitationOptions,
): Promise<{ invitation: Invitation; token: string }> {
  const now = new Date();
  const status = o.status ?? 'PENDING';
  const token = generateOpaqueToken();
  const invitation = await systemPrisma().invitation.create({
    data: {
      workspaceId: o.workspace.id,
      email: o.email ?? `invitee-${uuidv7()}@example.com`,
      role: o.role ?? 'STUDENT',
      firstName: o.firstName ?? null,
      lastName: o.lastName ?? null,
      guardianEmail: o.guardianEmail ?? null,
      birthDate: o.birthDate === undefined ? null : dateOnly(o.birthDate),
      tokenHash: token.hash,
      expiresAt: o.expiresAt ?? new Date(now.getTime() + INVITATION_TTL_MS),
      status,
      invitedByUserId: o.invitedBy.id,
      message: o.message ?? null,
      teacherUserId: o.teacherUserId ?? null,
      lastSentAt: now,
      ...(status === 'ACCEPTED' && {
        acceptedAt: now,
        acceptedByUserId: o.acceptedBy?.id ?? null,
      }),
      ...(status === 'REVOKED' && { revokedAt: now }),
    },
  });
  return { invitation, token: token.raw };
}

/** A random code of the invite-code alphabet (upper-case, like the API's codes). */
function randomInviteCode(): string {
  return Array.from(
    randomBytes(INVITE_CODE_LENGTH),
    (b) => INVITE_CODE_ALPHABET[b % INVITE_CODE_ALPHABET.length],
  ).join('');
}

export interface CreateInviteLinkOptions {
  workspace: Pick<Workspace, 'id'>;
  createdBy: Pick<User, 'id'>;
  /** Default `false`. */
  requiresApproval?: boolean;
  /** Default `INVITE_LINK_DEFAULT_MAX_USES`. */
  maxUses?: number;
  /** Default `0`. */
  usesCount?: number;
  /** Default `ACTIVE`. */
  status?: InviteLinkStatus;
  /** Default now + `INVITE_LINK_DEFAULT_TTL_DAYS`; `null` for no expiry. */
  expiresAt?: Date | null;
  label?: string;
  teacherUserId?: string;
}

/** A group invite link (STUDENT) written directly; `code` is its 8-character code. */
export async function createInviteLink(
  o: CreateInviteLinkOptions,
): Promise<{ link: InviteLink; code: string }> {
  const code = randomInviteCode();
  const link = await systemPrisma().inviteLink.create({
    data: {
      workspaceId: o.workspace.id,
      code,
      label: o.label ?? null,
      role: 'STUDENT',
      createdByUserId: o.createdBy.id,
      teacherUserId: o.teacherUserId ?? null,
      requiresApproval: o.requiresApproval ?? false,
      maxUses: o.maxUses ?? INVITE_LINK_DEFAULT_MAX_USES,
      usesCount: o.usesCount ?? 0,
      expiresAt:
        o.expiresAt === undefined
          ? new Date(Date.now() + INVITE_LINK_DEFAULT_TTL_DAYS * DAY_MS)
          : o.expiresAt,
      status: o.status ?? 'ACTIVE',
    },
  });
  return { link, code };
}

/** One parsed CSV row as the import stores it for the worker (`InvitationImport.rows`). */
export interface ImportRowInput {
  line: number;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  guardianEmail?: string | null;
  birthDate?: string | null;
  courseCodes?: string[];
}

/** A CSV import (`QUEUED` by default) holding `rows` as the preview would have stored them. */
export function createImport(o: {
  workspace: Pick<Workspace, 'id'>;
  createdBy: Pick<User, 'id'>;
  rows: ImportRowInput[];
  status?: ImportStatus;
  fileName?: string;
}): Promise<InvitationImport> {
  const rows = o.rows.map((r) => ({
    line: r.line,
    email: r.email,
    firstName: r.firstName ?? null,
    lastName: r.lastName ?? null,
    guardianEmail: r.guardianEmail ?? null,
    birthDate: r.birthDate ?? null,
    courseCodes: r.courseCodes ?? [],
  }));
  return systemPrisma().invitationImport.create({
    data: {
      workspaceId: o.workspace.id,
      createdByUserId: o.createdBy.id,
      fileName: o.fileName ?? 'students.csv',
      status: o.status ?? 'QUEUED',
      rows,
      report: [],
      totalRows: rows.length,
      validRows: rows.length,
    },
  });
}
