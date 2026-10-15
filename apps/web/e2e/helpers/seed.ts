import { CONSENT_VERSIONS, type CurrentConsentType } from '@tt/contracts';
import { request as playwrightRequest } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { TEST_CONSENT_TERMS_VERSION, postRegister, postTransient, uniqueEmail } from '../helpers';
import { extractLink, waitForEmail } from './mailpit';
import { totpCode } from './totp';

/** Same-origin base: the seed's cookies are the browser's (Next rewrites to the API). */
const BASE = 'http://localhost:3000';

export interface SeededUser {
  email: string;
  password: string;
  firstName: string;
  /** The account id (needed to seed memberships and to target API rows). */
  userId: string;
  /** TOTP secret, when `totp` was requested. */
  secret?: string;
  /** The 10 recovery codes, when `totp` was requested (shown once by the API). */
  recoveryCodes?: string[];
  /** Workspace id, when `organization` was requested (the caller is its OWNER). */
  orgWorkspaceId?: string;
}

export interface SeedOptions {
  /** Enable TOTP through the real setup + verify endpoints; returns the secret and codes. */
  totp?: boolean;
  /** Accept the pending consents (bumped TERMS + any other) after verification. */
  acceptConsents?: boolean;
  /** Create an organisation (the caller becomes OWNER, which makes 2FA mandatory). */
  organization?: boolean;
  /** Organisation name (default `École Test`); the admin console tests pass a unique one. */
  organizationName?: string;
  /** Profile timezone (default `Africa/Tunis`); the timezone-banner test seeds a fixed one. */
  timezone?: string;
}

/**
 * A verified teacher through the public API (isolated cookie jar, so the UI under test starts
 * anonymous): register, verify by the emailed token, optionally accept consents, enable TOTP and
 * create an organisation.
 */
export async function seedUser(opts: SeedOptions = {}): Promise<SeededUser> {
  const {
    totp = false,
    acceptConsents = true,
    organization = false,
    organizationName = 'École Test',
    timezone = 'Africa/Tunis',
  } = opts;
  const ctx = await playwrightRequest.newContext({ baseURL: BASE });
  try {
    const firstName = 'Mohamed';
    const email = uniqueEmail();
    const password = 'un mot de passe assez long';

    const reg = await postRegister(ctx, {
      kind: 'TEACHER',
      firstName,
      lastName: 'Ben Ali',
      email,
      password,
      locale: 'fr',
      timezone,
      acceptTerms: true,
      acceptPrivacy: true,
    });
    if (reg.status() !== 201) throw new Error(`register ${reg.status()}: ${await reg.text()}`);

    const mail = await waitForEmail(email, 'verify-email');
    const link = extractLink(mail.html, '/verify-email?token=');
    const token = link ? new URL(link).searchParams.get('token') : null;
    if (!token) throw new Error('no verify token in the email');
    const ver = await ctx.post('/api/v1/auth/verify-email', { data: { token } });
    if (ver.status() !== 200) throw new Error(`verify-email ${ver.status()}: ${await ver.text()}`);

    const me = await ctx.get('/api/v1/me');
    if (me.status() !== 200) throw new Error(`me ${me.status()}: ${await me.text()}`);
    const { id: userId } = (await me.json()) as { id: string };

    if (acceptConsents) {
      // The e2e API runs with a bumped TERMS version, so registration's static grant is pending.
      const { pendingConsents } = (await me.json()) as { pendingConsents: CurrentConsentType[] };
      for (const type of pendingConsents) {
        const version = type === 'TERMS' ? TEST_CONSENT_TERMS_VERSION : CONSENT_VERSIONS[type];
        // Transient-retried: the consent accept is idempotent, and this POST through the
        // `next dev` proxy is the one the full suite observed failing (500 / ECONNRESET).
        const res = await postTransient(ctx, `/api/v1/me/consents/${type}`, { version });
        if (res.status() !== 201)
          throw new Error(`consent ${type} ${res.status()}: ${await res.text()}`);
      }
    }

    let secret: string | undefined;
    let recoveryCodes: string[] | undefined;
    if (totp) {
      const setup = await ctx.post('/api/v1/auth/2fa/setup');
      if (setup.status() !== 200)
        throw new Error(`2fa/setup ${setup.status()}: ${await setup.text()}`);
      const body = (await setup.json()) as { secret: string };
      secret = body.secret;
      const confirm = await ctx.post('/api/v1/auth/2fa/verify', {
        data: { otpCode: totpCode(secret) },
      });
      if (confirm.status() !== 200) {
        throw new Error(`2fa/verify ${confirm.status()}: ${await confirm.text()}`);
      }
      recoveryCodes = ((await confirm.json()) as { recoveryCodes: string[] }).recoveryCodes;
    }

    let orgWorkspaceId: string | undefined;
    if (organization) {
      const ws = await ctx.post('/api/v1/workspaces', {
        data: { name: organizationName, timezone: 'Africa/Tunis' },
      });
      if (ws.status() !== 201) throw new Error(`workspaces ${ws.status()}: ${await ws.text()}`);
      orgWorkspaceId = ((await ws.json()) as { id: string }).id;
    }

    return { email, password, firstName, userId, secret, recoveryCodes, orgWorkspaceId };
  } finally {
    await ctx.dispose();
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Minimal `.env` reader (KEY=VALUE lines) so `psql` works without a docker daemon (CI). */
function systemDbUrl(): string {
  const envFile = new URL('../../../../.env', import.meta.url);
  let env: NodeJS.ProcessEnv = process.env;
  if (existsSync(envFile)) {
    env = { ...process.env };
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && match[1]) env[match[1]] = match[2]!.replace(/^["']|["']$/g, '');
    }
  }
  const url = env.DATABASE_URL_SYSTEM;
  if (!url) throw new Error('addOrgMember: DATABASE_URL_SYSTEM is not set');
  return url;
}

/**
 * SP1 ruling (plan Task 21): the public API has no "add member" route yet (students and teachers
 * join by invitation in SP2), so the e2e inserts the membership row directly as the postgres
 * superuser (bypasses RLS). Roles: TEACHER, ADMIN or STUDENT. Local docker runs through
 * `docker exec`; CI (service container, no docker daemon) falls back to a direct `psql`.
 */
export function addOrgMember(
  wid: string,
  userId: string,
  role: 'TEACHER' | 'ADMIN' | 'STUDENT' = 'TEACHER',
): void {
  if (!UUID.test(wid) || !UUID.test(userId)) throw new Error('addOrgMember: uuids required');
  const sql = `INSERT INTO membership (id, workspace_id, user_id, role, status, joined_at, created_at, updated_at) VALUES (gen_random_uuid(), '${wid}', '${userId}', '${role}', 'ACTIVE', now(), now(), now()) ON CONFLICT (workspace_id, user_id) DO NOTHING;`;
  try {
    execFileSync(
      'docker',
      ['exec', 'tt-postgres-1', 'psql', '-U', 'postgres', '-d', 'tt', '-c', sql],
      {
        stdio: 'pipe',
      },
    );
  } catch {
    execFileSync('psql', [systemDbUrl(), '-c', sql], { stdio: 'pipe' });
  }
}
