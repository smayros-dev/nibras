import { messages } from '@tt/i18n';
import {
  expect,
  test as base,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from '@playwright/test';
import { retryOn429, sleep } from './helpers/retry';

/**
 * Per-project UI language, set in `playwright.config.ts` (`use: { uiLocale: 'fr' | 'ar' }`,
 * typed through `defineConfig<LocaleTestOptions>`). Named `uiLocale` because Playwright's
 * built-in `locale` option is the browser context language.
 */
export interface LocaleTestOptions {
  uiLocale: 'fr' | 'ar';
}

export const test = base.extend<LocaleTestOptions>({
  uiLocale: ['fr', { option: true }],
});

export { expect };
export type { APIRequestContext };

/**
 * The API is started with this env (`playwright.config.ts` webServer): the current TERMS version
 * is bumped while registration still grants the static `CONSENT_VERSIONS`, so every e2e
 * registered user has a pending TERMS consent and the ConsentGate appears (AC-GDPR-06).
 */
export const TEST_CONSENT_TERMS_VERSION = 'terms-e2e-2026-11';

/** Translated message for a dotted `key`, e.g. `t('fr', 'auth.login.title')`. */
export function t(locale: string, key: string): string {
  let node: unknown = (messages as Record<string, unknown>)[locale];
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null)
      throw new Error(`Unknown message ${key} (${locale})`);
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'string') throw new Error(`Not a message: ${key} (${locale})`);
  return node;
}

/**
 * The toast whose title is exactly `message`, scoped to the toast region (named by
 * `shell.notifications`): neither the Radix announcer copy (prefixed) nor the same text elsewhere
 * on the page can match.
 */
export function toast(page: Page, locale: string, message: string): Locator {
  return page
    .getByRole('region', { name: t(locale, 'shell.notifications'), exact: true })
    .getByText(message, { exact: true });
}

/** A rich message (`t.rich` tags such as `<terms>…</terms>`) as the text the page renders. */
export function plainText(message: string): string {
  return message.replace(/<\/?[A-Za-z]+>/g, '');
}

/** A unique sign-up address for this millisecond (e2e users are never reused). */
export function uniqueEmail(): string {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/**
 * Production-build mode (`playwright.config.ts`): CI, or `E2E_PROD=1` locally — the web app runs
 * as the standalone server instead of `next dev`.
 */
export const E2E_PROD = !!process.env.CI || process.env.E2E_PROD === '1';

/**
 * `POST /auth/register` with the per-IP rate limit retried after the API's `Retry-After`: the
 * full e2e suite seeds many accounts back to back.
 */
export async function postRegister(ctx: APIRequestContext, body: Record<string, unknown>) {
  return retryOn429(() => ctx.post('/api/v1/auth/register', { data: body }), { attempts: 8 });
}

/**
 * `POST` an idempotent setup call, retrying the transient transport failures observed through
 * the `next dev` proxy under full-suite load (reset/failed connection, `5xx` answer): the
 * dev server stalls while compiling cold routes and drops in-flight proxied requests.
 * Idempotent targets only (e.g. `POST /me/consents/{type}` — 201 on every current-version
 * accept), never 4xx (each caller keeps its own status check). Against the production build
 * (`E2E_PROD`) there are no cold compiles and nothing is retried: a failure there is real.
 * On exhaustion the last response — or the last thrown error — surfaces to the caller.
 */
export async function postTransient(
  ctx: APIRequestContext,
  url: string,
  data: Record<string, unknown>,
  attempts = E2E_PROD ? 1 : 3,
): Promise<APIResponse> {
  let response: APIResponse | undefined;
  let thrown: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt);
    try {
      response = await ctx.post(url, { data });
      if (response.status() < 500) return response;
    } catch (error) {
      thrown = error;
    }
  }
  if (response) return response;
  throw thrown;
}

/**
 * Exact URL: `/fr/app` also matches `/fr/fr/app`, which would hide a doubled locale prefix
 * (next-intl's client router prefixes the locale itself — pushes must be locale-less).
 */
export function appUrl(path: string): string {
  return `http://localhost:3000${path}`;
}

const PASSWORD = 'un mot de passe assez long';

/** Fill the login form and submit. */
export async function fillLogin(page: Page, locale: string, email: string, password: string) {
  await page.getByLabel(t(locale, 'auth.login.email'), { exact: true }).fill(email);
  await page.getByLabel(t(locale, 'auth.login.password'), { exact: true }).fill(password);
  await page.getByRole('button', { name: t(locale, 'auth.login.submit') }).click();
}

/** Login through the UI and land on `/app` (no 2FA, or completing the OTP challenge). */
export async function uiLogin(
  page: Page,
  locale: string,
  user: { email: string; password: string; secret?: string },
) {
  // Bounded retry in dev mode only: a login POST lost through the `next dev` proxy (cold
  // compiles stall the dev server under full-suite load) leaves an alert on the login page
  // instead of navigating. The production build gets one attempt — a failure there is real.
  // The URL expects get an explicit timeout: the default 5 s is too tight under load.
  const attempts = E2E_PROD ? 1 : 2;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await page.goto(`/${locale}/login`);
      await fillLogin(page, locale, user.email, user.password || PASSWORD);
      if (user.secret) {
        const { totpCode } = await import('./helpers/totp');
        await expect(page).toHaveURL(appUrl(`/${locale}/2fa`), { timeout: 15_000 });
        await page
          .getByLabel(t(locale, 'auth.twoFactor.code'), { exact: true })
          .fill(totpCode(user.secret));
        await page.getByRole('button', { name: t(locale, 'auth.twoFactor.submit') }).click();
      }
      await expect(page).toHaveURL(appUrl(`/${locale}/app`), { timeout: 15_000 });
      return;
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      // Navigation may still be landing after the assertion timed out — don't log in twice.
      if (page.url().startsWith(appUrl(`/${locale}/app`))) return;
    }
  }
}

/**
 * Sign in through the API on an existing request context (cookies stick to it), completing the
 * 2FA challenge when the account has TOTP. Retries the per-IP login rate limit.
 */
export async function apiLogin(
  ctx: APIRequestContext,
  user: { email: string; password: string; secret?: string },
) {
  const { totpCode } = await import('./helpers/totp');
  const login = await retryOn429(() =>
    ctx.post('/api/v1/auth/login', {
      data: { email: user.email, password: user.password || PASSWORD },
    }),
  );
  if (login.status() !== 200) throw new Error(`login ${login.status()}: ${await login.text()}`);
  const body = (await login.json()) as { status: string; challengeToken?: string };
  if (body.status === 'TWO_FACTOR_REQUIRED') {
    if (!user.secret) throw new Error('2FA required but no TOTP secret');
    if (!body.challengeToken) throw new Error('missing challengeToken');
    const done = await ctx.post('/api/v1/auth/2fa/verify', {
      data: { challengeToken: body.challengeToken, otpCode: totpCode(user.secret) },
    });
    if (done.status() !== 200) throw new Error(`2fa verify ${done.status()}: ${await done.text()}`);
  }
}
