import { CONSENT_VERSIONS, type CurrentConsentType } from '@tt/contracts';
import { request as playwrightRequest } from '@playwright/test';
import { TEST_CONSENT_TERMS_VERSION, uniqueEmail } from '../helpers';
import { extractLink, waitForEmail } from './mailpit';
import { totpCode } from './totp';

/** Same-origin base: the seed's cookies are the browser's (Next rewrites to the API). */
const BASE = 'http://localhost:3000';

export interface SeededUser {
  email: string;
  password: string;
  firstName: string;
  /** TOTP secret, when `totp` was requested. */
  secret?: string;
  /** The 10 recovery codes, when `totp` was requested (shown once by the API). */
  recoveryCodes?: string[];
}

export interface SeedOptions {
  /** Enable TOTP through the real setup + verify endpoints; returns the secret and codes. */
  totp?: boolean;
  /** Accept the pending consents (bumped TERMS + any other) after verification. */
  acceptConsents?: boolean;
  /** Create an organisation (the caller becomes OWNER, which makes 2FA mandatory). */
  organization?: boolean;
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
    timezone = 'Africa/Tunis',
  } = opts;
  const ctx = await playwrightRequest.newContext({ baseURL: BASE });
  try {
    const firstName = 'Mohamed';
    const email = uniqueEmail();
    const password = 'un mot de passe assez long';

    const reg = await ctx.post('/api/v1/auth/register', {
      data: {
        kind: 'TEACHER',
        firstName,
        lastName: 'Ben Ali',
        email,
        password,
        locale: 'fr',
        timezone,
        acceptTerms: true,
        acceptPrivacy: true,
      },
    });
    if (reg.status() !== 201) throw new Error(`register ${reg.status()}: ${await reg.text()}`);

    const mail = await waitForEmail(email, 'verify-email');
    const link = extractLink(mail.html, '/verify-email?token=');
    const token = link ? new URL(link).searchParams.get('token') : null;
    if (!token) throw new Error('no verify token in the email');
    const ver = await ctx.post('/api/v1/auth/verify-email', { data: { token } });
    if (ver.status() !== 200) throw new Error(`verify-email ${ver.status()}: ${await ver.text()}`);

    if (acceptConsents) {
      // The e2e API runs with a bumped TERMS version, so registration's static grant is pending.
      const me = await ctx.get('/api/v1/me');
      const { pendingConsents } = (await me.json()) as { pendingConsents: CurrentConsentType[] };
      for (const type of pendingConsents) {
        const version = type === 'TERMS' ? TEST_CONSENT_TERMS_VERSION : CONSENT_VERSIONS[type];
        const res = await ctx.post(`/api/v1/me/consents/${type}`, { data: { version } });
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

    if (organization) {
      const ws = await ctx.post('/api/v1/workspaces', {
        data: { name: 'École Test', timezone: 'Africa/Tunis' },
      });
      if (ws.status() !== 201) throw new Error(`workspaces ${ws.status()}: ${await ws.text()}`);
    }

    return { email, password, firstName, secret, recoveryCodes };
  } finally {
    await ctx.dispose();
  }
}
