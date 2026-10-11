import { randomBytes } from 'node:crypto';
import { CONSENT_VERSIONS, type CurrentConsentType } from '@tt/contracts';
import {
  systemPrisma,
  uuidv7,
  type Locale,
  type Membership,
  type MembershipRole,
  type PlatformRole,
  type User,
  type UserStatus,
  type Workspace,
} from '@tt/db';
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
}

/** A user with a verified email and the password `'correct horse battery staple'` by default. */
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
  return { ...user, password };
}

/** PRD §8.2.1 defaults (`WorkspaceSettingsSchema` v1). */
function defaultSettings(timezone: string) {
  return {
    v: 1,
    default_timezone: timezone,
    teacher_join_window_min: 15,
    student_join_window_min: 10,
    empty_room_grace_min: 5,
    late_threshold_min: 10,
    present_ratio: 0.75,
    partial_ratio: 0.25,
    default_sequential_lessons: false,
    default_pdf_download: false,
    default_reminder_offsets_min: [1440, 15, 0],
  };
}

export interface CreateWorkspaceOptions {
  name: string;
  slug: string;
  status: Workspace['status'];
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
      ownerUserId: owner.id,
      defaultTimezone: owner.timezone,
      defaultLocale: owner.locale,
      storageQuotaBytes: (type === 'PERSONAL' ? 20n : 200n) * GIB,
      settings: defaultSettings(owner.timezone),
      ...(o.allowPersonalWorkspaces !== undefined && {
        allowPersonalWorkspaces: o.allowPersonalWorkspaces,
      }),
    },
  });
}

function addMember(workspace: Workspace, user: User, role: MembershipRole): Promise<Membership> {
  return systemPrisma().membership.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role,
      status: 'ACTIVE',
      joinedAt: new Date(),
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
  allowPersonalWorkspaces?: boolean;
  name?: string;
}): Promise<{ workspace: Workspace; memberships: Membership[] }> {
  const workspace = await createWorkspace('ORGANIZATION', o.owner, o.name ?? 'Organisation test', {
    allowPersonalWorkspaces: o.allowPersonalWorkspaces,
  });
  const members: [User, MembershipRole][] = [
    [o.owner, 'OWNER'],
    ...(o.admins ?? []).map((u): [User, MembershipRole] => [u, 'ADMIN']),
    ...(o.teachers ?? []).map((u): [User, MembershipRole] => [u, 'TEACHER']),
    ...(o.students ?? []).map((u): [User, MembershipRole] => [u, 'STUDENT']),
  ];
  const memberships: Membership[] = [];
  for (const [user, role] of members) memberships.push(await addMember(workspace, user, role));
  return { workspace, memberships };
}

/** Account-level consents granted at their current `CONSENT_VERSIONS`. */
export async function grantConsents(
  user: User,
  types: CurrentConsentType[] = ['TERMS', 'PRIVACY'],
): Promise<void> {
  const now = new Date();
  await systemPrisma().consent.createMany({
    data: types.map((type) => ({
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
