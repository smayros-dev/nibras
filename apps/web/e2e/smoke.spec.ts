import { messages } from '@tt/i18n';
import type { Page } from '@playwright/test';
import { appUrl, expect, plainText, t, test, apiLogin, uniqueEmail } from './helpers';
import { request as playwrightRequest } from '@playwright/test';
import { extractLink, extractOtpCode, waitForEmail } from './helpers/mailpit';
import { addOrgMember, seedUser } from './helpers/seed';
import { totpCode } from './helpers/totp';

/**
 * Plan Task 23: one full journey per locale on a mobile viewport — register, verify email and
 * phone, accept the code of conduct, create an organisation, enrol 2FA, assign a role, then the
 * globalSetup-seeded super-admin suspends and reactivates the workspace (banner comes and goes).
 * Both locales run sequentially in one test: two parallel journeys starve the dev servers.
 */

/** A raw `namespace.key` message id rendered instead of its translation (Review Focus 5). */
const RAW_KEY = new RegExp(`\\b(${Object.keys(messages.fr).join('|')})\\.[A-Za-z_]+\\b`);

// The dev OTP email's subject per locale (`emails.phone.otp_dev`); the body never says it.
const PHONE_OTP_HINT: Record<string, string> = {
  fr: 'code de vérification',
  ar: 'رمز التحقق من هاتفك',
};
const PASSWORD = 'un mot de passe assez long';
const API_BASE = 'http://localhost:3000';

/** The super-admin seeded by `globalSetup` (warmup.ts) through the create-super-admin CLI. */
function seededSuperAdmin() {
  const admin = {
    email: process.env.E2E_SUPER_ADMIN_EMAIL ?? '',
    password: process.env.E2E_SUPER_ADMIN_PASSWORD ?? '',
    secret: process.env.E2E_SUPER_ADMIN_TOTP_SECRET ?? '',
  };
  if (!admin.email || !admin.password || !admin.secret) {
    throw new Error(
      'E2E_SUPER_ADMIN_* missing: globalSetup (e2e/warmup.ts) must seed the super-admin',
    );
  }
  return admin;
}

async function fillRegister(page: Page, locale: string, email: string) {
  await page.getByLabel(t(locale, 'auth.register.firstName'), { exact: true }).fill('Mohamed');
  await page.getByLabel(t(locale, 'auth.register.lastName'), { exact: true }).fill('Ben Ali');
  await page.getByLabel(t(locale, 'auth.register.email'), { exact: true }).fill(email);
  await page.getByLabel(t(locale, 'auth.register.password'), { exact: true }).fill(PASSWORD);
  await page.getByLabel(plainText(t(locale, 'auth.register.acceptTerms')), { exact: true }).check();
}

async function runJourney(page: Page, locale: string) {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  // 1. Register (dir + no raw keys), then verify the email through Mailpit.
  const email = uniqueEmail();
  await page.goto(`/${locale}/register`);
  await expect(page.locator('html')).toHaveAttribute('dir', dir);
  await fillRegister(page, locale, email);
  await page.getByRole('button', { name: t(locale, 'auth.register.submit') }).click();
  await expect(page).toHaveURL(appUrl(`/${locale}/verify-email`));
  expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);

  const mail = await waitForEmail(email, 'verify-email');
  await page.goto(extractLink(mail.html, '/verify-email?token=')!);
  await page.getByRole('link', { name: t(locale, 'auth.verify.continue') }).click();
  await expect(page).toHaveURL(appUrl(`/${locale}/app`));
  // Every UI-registered user has one pending consent (the e2e bumps TERMS): accept the gate.
  // Wait for the grant POST itself; the dialog unmounts on the refreshed server layout, but the
  // dev-mode RSC refresh races — a full reload makes it deterministic.
  const consentPost = page.waitForResponse(
    (res) => res.url().includes('/api/v1/me/consents/') && res.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: t(locale, 'auth.consent.accept') }).click();
  const consentRes = await consentPost;
  if (consentRes.status() >= 400)
    throw new Error(`consent ${consentRes.status()}: ${await consentRes.text()}`);
  await page.reload();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);

  // 2. Phone verification (OTP from Mailpit) and the code of conduct.
  await page.goto(`/${locale}/app/settings/verification`);
  await page
    .getByLabel(t(locale, 'settings.verification.phoneNumber'), { exact: true })
    .fill('+21620123456');
  await page.getByRole('button', { name: t(locale, 'settings.verification.sendOtp') }).click();
  const otpMail = await waitForEmail(email, PHONE_OTP_HINT[locale]!);
  await page
    .getByLabel(t(locale, 'settings.verification.otpCode'), { exact: true })
    .fill(extractOtpCode(otpMail.text));
  await page.getByRole('button', { name: t(locale, 'settings.verification.verifyOtp') }).click();
  await expect(page.getByTestId('tick-PHONE')).toBeVisible();
  await page.getByLabel(t(locale, 'settings.verification.cocAccept'), { exact: true }).check();
  await page.getByRole('button', { name: t(locale, 'settings.verification.acceptCoc') }).click();
  await expect(page.getByTestId('tick-CODE_OF_CONDUCT')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);

  // 3. Create an organisation — the next request forces 2FA enrolment (OWNER, D-P12).
  const orgName = `Smoke ${locale.toUpperCase()} ${Date.now()}`;
  await page.goto(`/${locale}/app/settings/workspaces`);
  await page.getByLabel(t(locale, 'workspace.name'), { exact: true }).fill(orgName);
  await page.getByRole('button', { name: t(locale, 'workspace.submitOrganization') }).click();
  // Success is a toast: its title is exact (the Radix announcer prefixes it).
  await expect(page.getByText(t(locale, 'workspace.created'), { exact: true })).toBeVisible();

  await page.goto(`/${locale}/app`);
  await expect(page).toHaveURL(appUrl(`/${locale}/2fa/setup`));
  await expect(page.locator('html')).toHaveAttribute('dir', dir);
  // The setup page shows the otpauth secret: enrol with a real TOTP code.
  const secretText = (await page.getByTestId('totp-secret').innerText()).trim();
  const secret = secretText.split(':').pop()?.trim();
  expect(secret).toBeTruthy();
  await page.getByLabel(t(locale, 'auth.setup.code'), { exact: true }).fill(totpCode(secret!));
  await page.getByRole('button', { name: t(locale, 'auth.setup.submit') }).click();
  await expect(page.getByTestId('recovery-codes')).toBeVisible();
  await page.getByLabel(t(locale, 'auth.setup.savedAck'), { exact: true }).check();
  await page.getByRole('button', { name: t(locale, 'auth.setup.continue') }).click();
  await expect(page).toHaveURL(appUrl(`/${locale}/app`));
  expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);

  // The organisation's id, from the switcher menu on the dashboard (it navigates to the workspace).
  await page.getByRole('button', { name: t(locale, 'nav.currentWorkspace') }).click();
  await page.getByRole('menuitemradio', { name: orgName }).click();
  await expect(page).toHaveURL(/\/app\/w\/[^/?#]+$/, { timeout: 15_000 });
  const wid = new URL(page.url()).pathname.split('/').pop();
  expect(wid).toBeTruthy();

  // 4. Invitations are SP2: assign a role to a seeded member instead (promote to ADMIN).
  const member = await seedUser();
  addOrgMember(wid!, member.userId, 'TEACHER');
  await page.goto(`/${locale}/app/w/${wid}/members`);
  const memberRow = page.getByRole('row').filter({ hasText: member.email });
  await expect(memberRow).toBeVisible();
  await memberRow.getByRole('button', { name: t(locale, 'members.changeRole') }).click();
  await expect(page.getByRole('status')).toHaveText(t(locale, 'members.roleChanged'));
  expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);

  // 5. The globalSetup-seeded super-admin suspends, then reactivates, the organisation.
  const admin = seededSuperAdmin();
  const ctx = await playwrightRequest.newContext({ baseURL: API_BASE });
  try {
    await apiLogin(ctx, admin);
    const suspend = await ctx.post(`/api/v1/admin/workspaces/${wid}/suspend`, {
      data: { reason: 'smoke: suspension' },
    });
    if (suspend.status() >= 400)
      throw new Error(`suspend ${suspend.status()}: ${await suspend.text()}`);
  } finally {
    await ctx.dispose();
  }

  // The teacher sees the banner…
  await page.goto(`/${locale}/app/w/${wid}`);
  await expect(page.getByRole('status')).toHaveText(t(locale, 'workspace.suspended'));

  // …and loses it once the super-admin reactivates.
  const ctx2 = await playwrightRequest.newContext({ baseURL: API_BASE });
  try {
    await apiLogin(ctx2, admin);
    const unsuspend = await ctx2.post(`/api/v1/admin/workspaces/${wid}/unsuspend`);
    if (unsuspend.status() >= 400)
      throw new Error(`unsuspend ${unsuspend.status()}: ${await unsuspend.text()}`);
  } finally {
    await ctx2.dispose();
  }
  await page.reload();
  await expect(page.getByText(t(locale, 'workspace.suspended'))).toBeHidden();
  await expect(page.getByLabel(t(locale, 'workspace.name'), { exact: true })).toBeVisible();
}

test.describe('smoke (plan Task 23)', () => {
  // Two full journeys (emails, 2FA enrolment, suspension round-trip) need headroom.
  test.describe.configure({ timeout: 360_000 });

  test('teacher journey FR + AR: verify, organisation, 2FA, role, suspension round-trip', async ({
    page,
  }) => {
    await runJourney(page, 'fr');
    await runJourney(page, 'ar');
  });
});
