import { CONSENT_VERSIONS, type CurrentConsentType } from '@nibras/contracts';
import { messages } from '@nibras/i18n';
import { request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';
import { apiLogin, expect, t, TEST_CONSENT_TERMS_VERSION } from '../helpers';
import { extractLink, waitForEmail } from './mailpit';
import { seedUser, type SeededUser } from './seed';

/** Shared by the SP2 e2e specs (invitations, guardian): a verified teacher and his invitations. */

const BASE = 'http://localhost:3000';

/** A raw `namespace.key` message id rendered instead of its translation (Review Focus 6). */
export const RAW_KEY = new RegExp(`\\b(${Object.keys(messages.fr).join('|')})\\.[A-Za-z_]+\\b`);

/** `{name}` placeholders of a catalogue message filled in. */
export function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

/** `ahmed@example.com` → `a***@example.com` (`maskEmail`, `@nibras/contracts`). */
export function masked(email: string): string {
  const at = email.lastIndexOf('@');
  return `${email[0]}***${email.slice(at)}`;
}

/** A birth date `years` years ago (the birthday already passed), `YYYY-MM-DD`. */
export function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface Teacher {
  user: SeededUser;
  ctx: APIRequestContext;
  wid: string;
  workspaceName: string;
}

/** A verified teacher signed in on its own request context, with its personal workspace. */
export async function seedTeacher(): Promise<Teacher> {
  const user = await seedUser({ verifiedTeacher: true });
  const ctx = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(ctx, user);
  const res = await ctx.get('/api/v1/me/workspaces');
  expect(res.status()).toBe(200);
  const list = (await res.json()) as {
    workspace: { id: string; name: string; type: string };
  }[];
  const personal = list.find((m) => m.workspace.type === 'PERSONAL');
  if (!personal) throw new Error('the seeded teacher has no personal workspace');
  return { user, ctx, wid: personal.workspace.id, workspaceName: personal.workspace.name };
}

/** The last path segment of the first link in `html` containing `path` (an emailed token). */
export function tokenFromEmail(html: string, path: string): string {
  const link = extractLink(html, path);
  const token = link ? new URL(link).pathname.split('/').pop() : undefined;
  if (!token) throw new Error(`no ${path} link in the email`);
  return token;
}

/** Invites `email` as a STUDENT and returns the raw token of the emailed link. */
export async function inviteStudent(teacher: Teacher, email: string): Promise<string> {
  const res = await teacher.ctx.post(`/api/v1/workspaces/${teacher.wid}/invitations`, {
    data: { email, role: 'STUDENT' },
  });
  if (res.status() !== 201) throw new Error(`invite ${res.status()}: ${await res.text()}`);
  const mail = await waitForEmail(email, '/invite/');
  return tokenFromEmail(mail.html, '/invite/');
}

/** Accepts the pending-consent gate every e2e account meets (the e2e API bumps TERMS). */
export async function acceptConsentGate(page: Page, locale: string) {
  const gate = page.getByRole('dialog', { name: t(locale, 'auth.consent.title') });
  await expect(gate).toBeVisible({ timeout: 15_000 });
  await gate.getByRole('button', { name: t(locale, 'auth.consent.accept') }).click();
  await expect(gate).toBeHidden();
}

const MINOR_PASSWORD = 'un mot de passe assez long';

/**
 * The minor registers from the invitation through the API on `ctx` (a page's `request`: the
 * browser is then signed in as him) and accepts the pending consents, so the app opens directly.
 */
export async function registerMinorByApi(
  ctx: APIRequestContext,
  token: string,
  locale: string,
  guardianEmail: string,
): Promise<void> {
  const res = await ctx.post(`/api/v1/invitations/${token}/accept`, {
    data: {
      mode: 'REGISTER',
      firstName: 'Amina',
      lastName: 'Trabelsi',
      password: MINOR_PASSWORD,
      locale,
      timezone: 'Africa/Tunis',
      birthDate: yearsAgo(15),
      guardianEmail,
      acceptTerms: true,
      acceptPrivacy: true,
    },
  });
  if (res.status() !== 201) throw new Error(`accept ${res.status()}: ${await res.text()}`);
  const me = await ctx.get('/api/v1/me');
  const { pendingConsents } = (await me.json()) as { pendingConsents: CurrentConsentType[] };
  for (const type of pendingConsents) {
    const consent = await ctx.post(`/api/v1/me/consents/${type}`, {
      data: {
        version: type === 'TERMS' ? TEST_CONSENT_TERMS_VERSION : CONSENT_VERSIONS[type],
      },
    });
    if (consent.status() !== 201) throw new Error(`consent ${type} ${consent.status()}`);
  }
}

/** Grants through the API as the guardian; returns the guardian-page token. */
export async function grantByApi(ctx: APIRequestContext, consentToken: string): Promise<string> {
  const res = await ctx.post(`/api/v1/guardian-consent/${consentToken}`, {
    data: {
      decision: 'GRANT',
      guardianFirstName: 'Karim',
      guardianLastName: 'Trabelsi',
      relationship: 'PARENT',
      acceptNotice: true,
    },
  });
  if (res.status() !== 200) throw new Error(`grant ${res.status()}: ${await res.text()}`);
  const { guardianPageUrl } = (await res.json()) as { guardianPageUrl: string };
  return new URL(guardianPageUrl).pathname.split('/').pop()!;
}
