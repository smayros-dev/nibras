import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CONSENT_VERSIONS, REQUIRED_CONSENTS } from '@nibras/contracts';
import { db, type GuardedClient } from '@nibras/db';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../auth/crypto/password';
import { PasswordPolicy } from '../auth/crypto/password-policy';
import { env } from '../config/env';
import { createPwnedClient } from '../providers/providers.module';

/**
 * First super-admin bootstrap (PRD §8.16.4). Run from the repo with the environment loaded:
 *
 *     pnpm --filter @nibras/api cli create-super-admin --email <e> (--password <p> | --password-stdin) \
 *       [--first-name <f>] [--last-name <l>] [--promote-existing]
 *
 * `--password-stdin` reads the password from stdin (one trailing newline dropped) so it stays out
 * of the shell history and `ps`. `--promote-existing` is required to promote an account that
 * already exists (see `createSuperAdmin`).
 *
 * The super-admin console has no sign-up: this is the only way to grant `SUPER_ADMIN`.
 */

export interface CreateSuperAdminInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  /**
   * Allow promoting an existing account (default `false`). Even then the account must be ACTIVE,
   * have a verified email and `password` must be its current password.
   */
  promoteExisting?: boolean;
}

export type PromotionRefusalReason =
  'exists_without_flag' | 'email_unverified' | 'password_mismatch' | 'not_active' | 'no_password';

/** An existing account the CLI refuses to promote (spec SP1.6 F2: account pre-hijack). */
export class PromotionRefusedError extends Error {
  constructor(
    readonly reason: PromotionRefusalReason,
    email: string,
    /** The account status, for `not_active`. */
    status?: string,
  ) {
    super(refusalMessage(reason, email, status));
    this.name = 'PromotionRefusedError';
  }
}

function refusalMessage(reason: PromotionRefusalReason, email: string, status?: string): string {
  switch (reason) {
    case 'exists_without_flag':
      return `The account ${email} already exists. Re-run with --promote-existing to promote it (its email must be verified and --password must be its current password).`;
    case 'email_unverified':
      return `The account ${email} exists but its email is not verified: refusing to promote it (delete it or let its owner verify it first).`;
    case 'password_mismatch':
      return `The password does not match the existing account ${email}: refusing to promote it.`;
    case 'not_active':
      return `The account ${email} is ${status ?? 'not active'}: refusing to promote it`;
    case 'no_password':
      return `The account ${email} has no password set: refusing to promote it`;
  }
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
  promoteExisting: z.boolean().default(false),
});

/**
 * Creates the account (ACTIVE, email verified now, argon2id hash, the required consents at their
 * current `CONSENT_VERSIONS`, `platformRole SUPER_ADMIN`), or promotes the existing account with
 * that email. Promotion requires, in this order: `promoteExisting`, the account is ACTIVE, its
 * email is already verified (the CLI never verifies it), it has a password and `password` verifies
 * against it — otherwise `PromotionRefusedError`. This stops an attacker who pre-registered the
 * operator's email from being promoted. A promoted account gets `SUPER_ADMIN` and the missing
 * required consents; its password and names are kept (promotion never rewrites credentials, so
 * the policy only applies on creation). Idempotent: a second run (with the flag) changes nothing
 * but is audited again. Audits `user.super_admin_granted` (actor `SYSTEM`).
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
    select: { id: true, status: true, emailVerifiedAt: true, passwordHash: true },
  });
  let passwordHash: string | undefined;
  if (existing) {
    if (!input.promoteExisting) throw new PromotionRefusedError('exists_without_flag', input.email);
    if (existing.status !== 'ACTIVE') {
      throw new PromotionRefusedError('not_active', input.email, existing.status);
    }
    if (existing.emailVerifiedAt === null) {
      throw new PromotionRefusedError('email_unverified', input.email);
    }
    if (!existing.passwordHash) throw new PromotionRefusedError('no_password', input.email);
    if (!(await verifyPassword(existing.passwordHash, input.password))) {
      throw new PromotionRefusedError('password_mismatch', input.email);
    }
  } else {
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
          select: { id: true },
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
          select: { id: true },
        });
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

const FLAGS: Record<string, 'email' | 'password' | 'firstName' | 'lastName'> = {
  '--email': 'email',
  '--password': 'password',
  '--first-name': 'firstName',
  '--last-name': 'lastName',
};

/**
 * `create-super-admin --email <e> (--password <p> | --password-stdin) [--first-name <f>]
 * [--last-name <l>] [--promote-existing]`. With `--password-stdin` the password is `stdin` with
 * one trailing newline (`\n` or `\r\n`) removed.
 */
export function parseCreateSuperAdminArgs(argv: string[], stdin?: string): CreateSuperAdminInput {
  const [command, ...rest] = argv;
  if (command !== COMMAND) {
    throw new Error(`Unknown command "${command ?? ''}"; expected ${COMMAND}`);
  }
  const out: Partial<CreateSuperAdminInput> = {};
  let passwordStdin = false;
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i]!;
    if (flag === '--promote-existing') {
      out.promoteExisting = true;
      continue;
    }
    if (flag === '--password-stdin') {
      passwordStdin = true;
      continue;
    }
    const key = FLAGS[flag];
    const value = rest[i + 1];
    if (!key) throw new Error(`Unknown option ${flag}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    out[key] = value;
    i += 1;
  }
  if (passwordStdin) {
    if (out.password !== undefined) {
      throw new Error('--password and --password-stdin are mutually exclusive');
    }
    if (stdin === undefined) throw new Error('--password-stdin: nothing was read from stdin');
    out.password = stdin.replace(/\r?\n$/, '');
  }
  if (out.email === undefined) throw new Error('--email is required');
  if (out.password === undefined) throw new Error('--password (or --password-stdin) is required');
  return out as CreateSuperAdminInput;
}

/** `node dist/cli/create-super-admin.js create-super-admin --email … --password …`. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // Stdin is read only when asked for: otherwise an interactive run would block on it.
  const stdin = argv.includes('--password-stdin') ? readFileSync(0, 'utf8') : undefined;
  const input = parseCreateSuperAdminArgs(argv, stdin);
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
