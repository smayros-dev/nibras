import { randomBytes } from 'node:crypto';
import {
  CONSENT_VERSIONS,
  defaultWorkspaceSettings,
  type CurrentConsentType,
} from '@nibras/contracts';
import {
  systemPrisma,
  uuidv7,
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
