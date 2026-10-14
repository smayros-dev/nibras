import { randomUUID } from 'node:crypto';
import { CONSENT_VERSIONS, REQUIRED_CONSENTS } from '@tt/contracts';
import { db, type GuardedClient } from '@tt/db';
import { z } from 'zod';
import { hashPassword } from '../auth/crypto/password';
import { PasswordPolicy } from '../auth/crypto/password-policy';
import { env } from '../config/env';
import { createPwnedClient } from '../providers/providers.module';

/**
 * First super-admin bootstrap (PRD §8.16.4). Run from the repo with the environment loaded:
 *
 *     pnpm --filter @tt/api cli create-super-admin --email <e> --password <p> \
 *       [--first-name <f>] [--last-name <l>]
 *
 * The super-admin console has no sign-up: this is the only way to grant `SUPER_ADMIN`.
 */

export interface CreateSuperAdminInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface CreateSuperAdminResult {
  userId: string;
  /** `false` when an existing account was promoted (or already was a super-admin). */
  created: boolean;
}

const COMMAND = 'create-super-admin';
const CONSENT_IP = '127.0.0.1';
const CONSENT_USER_AGENT = 'cli:create-super-admin';

const InputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string(),
  firstName: z.string().trim().min(1).max(100).default('Super'),
  lastName: z.string().trim().min(1).max(100).default('Admin'),
});

/**
 * Creates the account (ACTIVE, email verified now, argon2id hash, the required consents at their
 * current `CONSENT_VERSIONS`, `platformRole SUPER_ADMIN`), or promotes the existing account with
 * that email: `SUPER_ADMIN`, email marked verified if it was not, missing required consents
 * granted; its password and names are kept (promotion never rewrites credentials, so the policy
 * only applies on creation). An account that is not ACTIVE is refused. Idempotent: a second run
 * changes nothing but is audited again. Audits `user.super_admin_granted` (actor `SYSTEM`).
 * 2FA is not set up here: the account gates force its setup at first login.
 */
export async function createSuperAdmin(
  client: Pick<GuardedClient, 'user' | '$transaction'>,
  raw: CreateSuperAdminInput,
  policy: PasswordPolicy,
): Promise<CreateSuperAdminResult> {
  const parsed = InputSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid input: ${fields}`);
  }
  const input = parsed.data;
  const existing = await client.user.findUnique({
    where: { email: input.email },
    select: { id: true, status: true },
  });
  if (existing && existing.status !== 'ACTIVE') {
    throw new Error(`The account ${input.email} is ${existing.status}: refusing to promote it`);
  }
  let passwordHash: string | undefined;
  if (!existing) {
    const check = await policy.validate(input.password);
    if (!check.ok) throw new Error(`Password rejected: ${check.code}`);
    passwordHash = await hashPassword(input.password);
  }

  const now = new Date();
  return client.$transaction(async (tx) => {
    const user = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: { platformRole: 'SUPER_ADMIN' },
          select: { id: true, emailVerifiedAt: true },
        })
      : await tx.user.create({
          data: {
            email: input.email,
            passwordHash: passwordHash!,
            firstName: input.firstName,
            lastName: input.lastName,
            emailVerifiedAt: now,
            platformRole: 'SUPER_ADMIN',
            status: 'ACTIVE',
          },
          select: { id: true, emailVerifiedAt: true },
        });
    if (user.emailVerifiedAt === null) {
      await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });
    }
    const held = await tx.consent.findMany({
      where: {
        userId: user.id,
        workspaceId: null,
        granted: true,
        revokedAt: null,
        OR: REQUIRED_CONSENTS.map((type) => ({ type, version: CONSENT_VERSIONS[type] })),
      },
      select: { type: true },
    });
    const missing = REQUIRED_CONSENTS.filter((type) => !held.some((c) => c.type === type));
    if (missing.length > 0) {
      await tx.consent.createMany({
        data: missing.map((type) => ({
          userId: user.id,
          type,
          version: CONSENT_VERSIONS[type],
          granted: true,
          grantedAt: now,
          ip: CONSENT_IP,
          userAgent: CONSENT_USER_AGENT,
        })),
      });
    }
    await tx.auditLog.create({
      data: {
        action: 'user.super_admin_granted',
        entityType: 'User',
        entityId: user.id,
        actorUserId: null,
        actorRole: 'SYSTEM',
        after: {
          platformRole: 'SUPER_ADMIN',
          created: !existing,
          consentsGranted: missing.map((type) => CONSENT_VERSIONS[type]),
        },
        userAgent: CONSENT_USER_AGENT,
        requestId: `cli-${randomUUID()}`,
      },
    });
    return { userId: user.id, created: !existing };
  });
}

const FLAGS: Record<string, keyof CreateSuperAdminInput> = {
  '--email': 'email',
  '--password': 'password',
  '--first-name': 'firstName',
  '--last-name': 'lastName',
};

/** `create-super-admin --email <e> --password <p> [--first-name <f>] [--last-name <l>]`. */
export function parseCreateSuperAdminArgs(argv: string[]): CreateSuperAdminInput {
  const [command, ...rest] = argv;
  if (command !== COMMAND) {
    throw new Error(`Unknown command "${command ?? ''}"; expected ${COMMAND}`);
  }
  const out: Partial<CreateSuperAdminInput> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]!;
    const key = FLAGS[flag];
    const value = rest[i + 1];
    if (!key) throw new Error(`Unknown option ${flag}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    out[key] = value;
  }
  for (const flag of ['--email', '--password']) {
    if (out[FLAGS[flag]!] === undefined) throw new Error(`${flag} is required`);
  }
  return out as CreateSuperAdminInput;
}

/** `node dist/cli/create-super-admin.js create-super-admin --email … --password …`. */
async function main(): Promise<void> {
  const input = parseCreateSuperAdminArgs(process.argv.slice(2));
  const result = await createSuperAdmin(db, input, new PasswordPolicy(createPwnedClient(env)));
  console.log(
    `${result.created ? 'Created' : 'Promoted'} super-admin ${input.email.trim().toLowerCase()} (${result.userId}).`,
  );
  if (!result.created) console.log('The existing password was kept.');
  console.log('Reminder: two-factor authentication setup is forced at the first login.');
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
