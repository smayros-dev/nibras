import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { request as playwrightRequest } from '@playwright/test';
import { TEST_CONSENT_TERMS_VERSION, postRegister, postTransient, uniqueEmail } from '../helpers';
import { extractLink, waitForEmail } from './mailpit';
import { retryOn429 } from './retry';
import { totpCode } from './totp';

const BASE = 'http://localhost:3000';
const API_DIR = new URL('../../../api/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO_ROOT = new URL('../../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Minimal `.env` reader (KEY=VALUE lines) for the CLI child process. */
function repoEnv(): NodeJS.ProcessEnv {
  const envFile = `${REPO_ROOT}.env`;
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && match[1]) env[match[1]] = match[2]!.replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

/** A seeded super-admin, ready for `uiLogin` (2FA challenge included). */
export interface SeededSuperAdmin {
  email: string;
  password: string;
  firstName: string;
  userId: string;
  secret: string;
}

/**
 * Registers a throwaway teacher, verifies the email, sets up TOTP (mandatory for SUPER_ADMIN),
 * promotes the account with the `create-super-admin` CLI (password kept) and re-accepts the
 * e2e-bumped TERMS version. Idempotent per email; each call makes a fresh account.
 */
export async function seedSuperAdmin(): Promise<SeededSuperAdmin> {
  const cli = `${API_DIR}dist/cli/create-super-admin.js`;
  if (!existsSync(cli)) throw new Error(`missing ${cli}: build @nibras/api before running e2e`);

  const ctx = await playwrightRequest.newContext({ baseURL: BASE });
  try {
    const email = uniqueEmail();
    const password = 'un mot de passe assez long';

    const reg = await postRegister(ctx, {
      kind: 'TEACHER',
      firstName: 'Super',
      lastName: 'Admin',
      email,
      password,
      locale: 'fr',
      timezone: 'UTC',
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

    const setup = await ctx.post('/api/v1/auth/2fa/setup');
    if (setup.status() !== 200)
      throw new Error(`2fa/setup ${setup.status()}: ${await setup.text()}`);
    const { secret } = (await setup.json()) as { secret: string };
    const confirm = await ctx.post('/api/v1/auth/2fa/verify', {
      data: { otpCode: totpCode(secret) },
    });
    if (confirm.status() !== 200)
      throw new Error(`2fa/verify ${confirm.status()}: ${await confirm.text()}`);

    execFileSync(
      process.execPath,
      [cli, 'create-super-admin', '--email', email, '--password', password],
      { cwd: API_DIR, env: repoEnv(), stdio: 'pipe' },
    );

    // The CLI grants the static TERMS version; the e2e API requires the bumped one.
    // Idempotent accept, transient-retried (this POST failed once in globalSetup, 500).
    const consent = await postTransient(ctx, '/api/v1/me/consents/TERMS', {
      version: TEST_CONSENT_TERMS_VERSION,
    });
    if (consent.status() !== 201 && consent.status() !== 409)
      throw new Error(`consent ${consent.status()}: ${await consent.text()}`);

    const me = await ctx.get('/api/v1/me');
    if (me.status() !== 200) throw new Error(`me ${me.status()}: ${await me.text()}`);
    const { id: userId } = (await me.json()) as { id: string };

    return { email, password, firstName: 'Super', userId, secret };
  } finally {
    await ctx.dispose();
  }
}

/**
 * Suspend a workspace through the admin API (plan Task 21, suspended-banner e2e): seeds a
 * super-admin, logs in and calls `POST /admin/workspaces/{wid}/suspend`.
 */
export async function suspendWorkspaceAsSuperAdmin(wid: string, reason = 'e2e suspension') {
  const admin = await seedSuperAdmin();
  const ctx = await playwrightRequest.newContext({ baseURL: BASE });
  try {
    // Login (with 2FA challenge), retrying the per-IP rate limit after its `Retry-After`.
    const login = await retryOn429(() =>
      ctx.post('/api/v1/auth/login', {
        data: { email: admin.email, password: admin.password },
      }),
    );
    if (login.status() !== 200) throw new Error(`login ${login.status()}: ${await login.text()}`);
    const loginBody = (await login.json()) as { status: string; challengeToken?: string };
    if (loginBody.status === 'TWO_FACTOR_REQUIRED') {
      if (!loginBody.challengeToken) throw new Error('missing challengeToken');
      const done = await ctx.post('/api/v1/auth/2fa/verify', {
        data: { challengeToken: loginBody.challengeToken, otpCode: totpCode(admin.secret) },
      });
      if (done.status() !== 200)
        throw new Error(`2fa verify ${done.status()}: ${await done.text()}`);
    }

    const suspend = await ctx.post(`/api/v1/admin/workspaces/${wid}/suspend`, {
      data: { reason },
    });
    if (suspend.status() >= 400)
      throw new Error(`suspend ${suspend.status()}: ${await suspend.text()}`);
  } finally {
    await ctx.dispose();
  }
}
