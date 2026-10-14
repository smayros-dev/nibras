import { messages } from '@tt/i18n';
import {
  TEST_CONSENT_TERMS_VERSION,
  appUrl,
  expect,
  fillLogin,
  t,
  test,
  uiLogin,
  uniqueEmail,
  type APIRequestContext,
} from './helpers';
import { extractLink, waitForEmail } from './helpers/mailpit';
import { seedUser } from './helpers/seed';
import { totpCode, wrongTotpCode } from './helpers/totp';

/** A raw `namespace.key` message id rendered instead of its translation (Review Focus 5). */
const RAW_KEY = new RegExp(`\\b(${Object.keys(messages.fr).join('|')})\\.[A-Za-z_]+\\b`);

const PASSWORD = 'un mot de passe assez long';

/** Fill the register form; `password` defaults to a policy-valid one. */
async function fillRegister(
  page: import('@playwright/test').Page,
  locale: string,
  email: string,
  password = PASSWORD,
) {
  await page.getByLabel(t(locale, 'auth.register.firstName'), { exact: true }).fill('Mohamed');
  await page.getByLabel(t(locale, 'auth.register.lastName'), { exact: true }).fill('Ben Ali');
  await page.getByLabel(t(locale, 'auth.register.email'), { exact: true }).fill(email);
  await page.getByLabel(t(locale, 'auth.register.password'), { exact: true }).fill(password);
  await page.getByLabel(t(locale, 'auth.register.acceptTerms'), { exact: true }).check();
}

test('teacher signs up, verifies by email, lands on the dashboard', async ({
  page,
  uiLocale: locale,
}) => {
  const email = uniqueEmail();
  await page.goto(`/${locale}/register`);
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  await fillRegister(page, locale, email);
  await page.getByRole('button', { name: t(locale, 'auth.register.submit') }).click();

  await expect(page).toHaveURL(appUrl(`/${locale}/verify-email`));
  // Role-based: Next's route announcer duplicates the page text, breaking getByText strict mode.
  await expect(
    page.getByRole('heading', { level: 1, name: t(locale, 'auth.verify.pending') }),
  ).toBeVisible();

  const mail = await waitForEmail(email, 'verify-email');
  await page.goto(extractLink(mail.html, '/verify-email?token=')!);
  await expect(
    page.getByRole('heading', { level: 1, name: t(locale, 'auth.verify.done') }),
  ).toBeVisible();
  await page.getByRole('link', { name: t(locale, 'auth.verify.continue') }).click();

  await expect(page).toHaveURL(appUrl(`/${locale}/app`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mohamed');
  // Review Focus 5: no raw message key anywhere in the rendered text.
  expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);
});

test('short password shows a translated field error, not a raw key', async ({
  page,
  uiLocale: locale,
}) => {
  await page.goto(`/${locale}/register`);
  await fillRegister(page, locale, uniqueEmail(), 'short');
  await page.getByRole('button', { name: t(locale, 'auth.register.submit') }).click();
  await expect(page.getByText(t(locale, 'errors.PASSWORD_TOO_SHORT'))).toBeVisible();
  await expect(page).toHaveURL(appUrl(`/${locale}/register`)); // no API round-trip
});

test('login with 2FA: challenge page, wrong code error, right code enters; recovery code path', async ({
  page,
  uiLocale: locale,
}) => {
  const user = await seedUser({ totp: true });

  await page.goto(`/${locale}/login`);
  await fillLogin(page, locale, user.email, user.password);
  await expect(page).toHaveURL(appUrl(`/${locale}/2fa`));

  await page
    .getByLabel(t(locale, 'auth.twoFactor.code'), { exact: true })
    .fill(wrongTotpCode(user.secret!));
  await page.getByRole('button', { name: t(locale, 'auth.twoFactor.submit') }).click();
  await expect(page.getByText(t(locale, 'errors.TWO_FACTOR_INVALID'))).toBeVisible();

  await page
    .getByLabel(t(locale, 'auth.twoFactor.code'), { exact: true })
    .fill(totpCode(user.secret!));
  await page.getByRole('button', { name: t(locale, 'auth.twoFactor.submit') }).click();
  await expect(page).toHaveURL(appUrl(`/${locale}/app`));

  // Recovery path: a fresh session, the same challenge, one recovery code (consumed).
  await page.context().clearCookies();
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`/${locale}/login`);
  await fillLogin(page, locale, user.email, user.password);
  await expect(page).toHaveURL(appUrl(`/${locale}/2fa`));
  await page.getByRole('button', { name: t(locale, 'auth.twoFactor.useRecovery') }).click();
  const recovery = user.recoveryCodes?.[0];
  if (!recovery) throw new Error('seedUser returned no recovery codes');
  await page.getByLabel(t(locale, 'auth.twoFactor.recoveryCode'), { exact: true }).fill(recovery);
  await page.getByRole('button', { name: t(locale, 'auth.twoFactor.submitRecovery') }).click();
  await expect(page).toHaveURL(appUrl(`/${locale}/app`));
});

test('AC-AUTH-05 UI: org admin without 2FA is forced to /2fa/setup and cannot leave before confirming', async ({
  page,
  uiLocale: locale,
}) => {
  const user = await seedUser({ organization: true });

  await page.goto(`/${locale}/login`);
  await fillLogin(page, locale, user.email, user.password);
  await expect(page).toHaveURL(appUrl(`/${locale}/2fa/setup`));

  // Leaving for the app bounces straight back until 2FA is confirmed.
  await page.goto(`/${locale}/app`);
  await expect(page).toHaveURL(appUrl(`/${locale}/2fa/setup`));
});

test('forgot/reset: expired link shows "Lien expiré" and a request-new link', async ({
  page,
  uiLocale: locale,
}) => {
  await page.goto(`/${locale}/forgot-password`);
  await page.getByLabel(t(locale, 'auth.forgot.email'), { exact: true }).fill(uniqueEmail());
  await page.getByRole('button', { name: t(locale, 'auth.forgot.submit') }).click();
  await expect(page.getByText(t(locale, 'auth.forgot.always'))).toBeVisible();

  await page.goto(`/${locale}/reset-password?token=bogus`);
  await page
    .getByLabel(t(locale, 'auth.reset.newPassword'), { exact: true })
    .fill('un nouveau mot de passe');
  await page.getByRole('button', { name: t(locale, 'auth.reset.submit') }).click();
  await expect(page.getByText(t(locale, 'auth.reset.tokenInvalid'))).toBeVisible();
  await expect(page.getByRole('link', { name: t(locale, 'auth.reset.requestNew') })).toBeVisible();
});

test('consent gate blocks the app after a version bump until accepted', async ({
  page,
  uiLocale: locale,
}) => {
  const user = await seedUser({ acceptConsents: false });

  await uiLogin(page, locale, user);
  // The gate lists the current (bumped) TERMS version the user must accept.
  await expect(page.getByText(TEST_CONSENT_TERMS_VERSION)).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.getByRole('button', { name: t(locale, 'auth.consent.accept') }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(user.firstName);
});

/** Unused import guard: APIRequestContext is re-exported for future specs. */
export type { APIRequestContext };
