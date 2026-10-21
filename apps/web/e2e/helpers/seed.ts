import { CONSENT_VERSIONS, type CurrentConsentType } from '@nibras/contracts';
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import {
  TEST_CONSENT_TERMS_VERSION,
  apiLogin,
  postRegister,
  postTransient,
  uniqueEmail,
} from '../helpers';
import { extractLink, extractOtpCode, waitForEmail } from './mailpit';
import { totpCode } from './totp';

/** Same-origin base: the seed's cookies are the browser's (Next rewrites to the API). */
const BASE = 'http://localhost:3000';

export interface SeededUser {
  email: string;
  password: string;
  firstName: string;
  /** The account id (needed to target API rows: assignments, reports, members). */
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
  /**
   * Complete the teacher verification (D-O6: phone OTP from the dev email + code of conduct), so
   * the account may send invitations (SP2). Needs `acceptConsents` (the default).
   */
  verifiedTeacher?: boolean;
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
    verifiedTeacher = false,
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

    if (verifiedTeacher) {
      const otp = await ctx.post('/api/v1/me/phone/request-otp', {
        data: { phoneE164: '+21620123456' },
      });
      if (otp.status() !== 202) throw new Error(`request-otp ${otp.status()}: ${await otp.text()}`);
      // The dev OTP email (`emails.phone.otp_dev`, fr: the account's locale).
      const otpMail = await waitForEmail(email, 'code de vérification');
      const phone = await ctx.post('/api/v1/me/phone/verify-otp', {
        data: { otpCode: extractOtpCode(otpMail.text) },
      });
      if (phone.status() !== 200)
        throw new Error(`verify-otp ${phone.status()}: ${await phone.text()}`);
      const coc = await postTransient(ctx, '/api/v1/me/consents/CODE_OF_CONDUCT', {
        version: CONSENT_VERSIONS.CODE_OF_CONDUCT,
      });
      if (coc.status() !== 201)
        throw new Error(`code of conduct ${coc.status()}: ${await coc.text()}`);
    }

    let secret: string | undefined;
    let recoveryCodes: string[] | undefined;
    if (totp) {
      const setup = await ctx.post('/api/v1/auth/2fa/setup', { data: { password } });
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

/** A request context signed in as the inviter, or the inviter's credentials (signed in here). */
export type Inviter = APIRequestContext | { email: string; password: string; secret?: string };

/** A birth date 30 years ago (`YYYY-MM-DD`): an adult student (D-P3, minor = under 18). */
function adultBirthDate(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 30);
  return d.toISOString().slice(0, 10);
}

/**
 * Seeds an ACTIVE membership through the real invitation flow (SP2 T14; replaces the SP1 psql
 * insert): the inviter — a verified teacher (D-O6) with `student.invite`, plus staff management
 * for TEACHER / ADMIN in an organisation — `POST`s `/workspaces/{wid}/invitations`, the emailed
 * link's token comes from Mailpit, and the member, signed in on his own context, accepts with
 * `{ mode: 'JOIN' }` (a STUDENT also sends an adult birth date). Returns the invitation id.
 */
export async function joinByInvitation(
  inviter: Inviter,
  wid: string,
  member: { email: string; password: string; secret?: string },
  role: 'TEACHER' | 'ADMIN' | 'STUDENT' = 'TEACHER',
): Promise<string> {
  const own = 'post' in inviter ? null : await playwrightRequest.newContext({ baseURL: BASE });
  const memberCtx = await playwrightRequest.newContext({ baseURL: BASE });
  try {
    const inviterCtx = own ?? (inviter as APIRequestContext);
    if (own) await apiLogin(own, inviter as { email: string; password: string; secret?: string });
    const res = await inviterCtx.post(`/api/v1/workspaces/${wid}/invitations`, {
      data: { email: member.email, role },
    });
    if (res.status() !== 201) throw new Error(`invite ${res.status()}: ${await res.text()}`);
    const { id } = (await res.json()) as { id: string };

    const mail = await waitForEmail(member.email, '/invite/');
    const link = extractLink(mail.html, '/invite/');
    const token = link ? new URL(link).pathname.split('/').pop() : undefined;
    if (!token) throw new Error('no /invite/ link in the invitation email');

    await apiLogin(memberCtx, member);
    const accept = await memberCtx.post(`/api/v1/invitations/${token}/accept`, {
      data: { mode: 'JOIN', ...(role === 'STUDENT' ? { birthDate: adultBirthDate() } : {}) },
    });
    if (accept.status() !== 201)
      throw new Error(`accept ${accept.status()}: ${await accept.text()}`);
    return id;
  } finally {
    await memberCtx.dispose();
    await own?.dispose();
  }
}
