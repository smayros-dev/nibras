import { appUrl, expect, fillLogin, t, test, uiLogin } from './helpers';
import { extractOtpCode, waitForEmail } from './helpers/mailpit';
import { seedUser } from './helpers/seed';

/** The dev phone OTP email's subject contains this (its `phone.otp_dev` key never appears in content). */
const PHONE_OTP_HINT = 'code de vérification';

test('profile: change language to ar flips the UI to RTL and persists', async ({
  page,
  uiLocale: locale,
}) => {
  const user = await seedUser();
  await uiLogin(page, locale, user);
  await page.goto(`/${locale}/app/settings/profile`);

  // The language select is the register selector reused; choosing `ar` and saving flips dir.
  await page.getByLabel(t(locale, 'settings.profile.language'), { exact: true }).selectOption('ar');
  await page.getByRole('button', { name: t(locale, 'settings.profile.save') }).click();

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page).toHaveURL(appUrl('/ar/app/settings/profile'), { timeout: 15_000 });

  // Persisted: a fresh load under the stored locale is still RTL with the ar nav label.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('timezone banner appears when the browser tz differs and PATCHes on Oui', async ({
  browser,
  uiLocale: locale,
}) => {
  const user = await seedUser();
  const ctx = await browser.newContext({ timezoneId: 'Europe/Paris' });
  const page = await ctx.newPage();
  try {
    await page.goto(`/${locale}/login`);
    await fillLogin(page, locale, user.email, user.password);
    await expect(page).toHaveURL(appUrl(`/${locale}/app`), { timeout: 15_000 });

    await expect(page.getByText('Europe/Paris')).toBeVisible();
    await page.getByRole('button', { name: t(locale, 'settings.timezone.accept') }).click();
    // The banner unmounts once the PATCH lands (it would stay visible on an error).
    await expect(page.getByText('Europe/Paris')).toBeHidden();

    const res = await ctx.request.get('http://localhost:3000/api/v1/me');
    const me = (await res.json()) as { timezone: string };
    expect(me.timezone).toBe('Europe/Paris');
  } finally {
    await ctx.close();
  }
});

test('verification page: send OTP, verify phone, accept code of conduct, three ticks green', async ({
  page,
  uiLocale: locale,
}) => {
  const user = await seedUser();
  await uiLogin(page, locale, user);
  await page.goto(`/${locale}/app/settings/verification`);

  await page
    .getByLabel(t(locale, 'settings.verification.phoneNumber'), { exact: true })
    .fill('+21620123456');
  await page.getByRole('button', { name: t(locale, 'settings.verification.sendOtp') }).click();

  const mail = await waitForEmail(user.email, PHONE_OTP_HINT);
  const otp = extractOtpCode(mail.text);
  await page.getByLabel(t(locale, 'settings.verification.otpCode'), { exact: true }).fill(otp);
  await page.getByRole('button', { name: t(locale, 'settings.verification.verifyOtp') }).click();

  await expect(page.getByTestId('tick-PHONE')).toBeVisible();

  await page.getByLabel(t(locale, 'settings.verification.cocAccept'), { exact: true }).check();
  await page.getByRole('button', { name: t(locale, 'settings.verification.acceptCoc') }).click();

  await expect(page.getByTestId('tick-EMAIL')).toBeVisible();
  await expect(page.getByTestId('tick-PHONE')).toBeVisible();
  await expect(page.getByTestId('tick-CODE_OF_CONDUCT')).toBeVisible();
});

test('security: devices list shows this device; sign out everywhere ends the session', async ({
  page,
  uiLocale: locale,
}) => {
  const user = await seedUser();
  await uiLogin(page, locale, user);
  await page.goto(`/${locale}/app/settings/security`);

  await expect(page.getByTestId('device-current')).toBeVisible();

  // The confirmation is an in-page alert dialog (no `window.confirm`).
  await page.getByRole('button', { name: t(locale, 'settings.security.signOutAll') }).click();
  const confirm = page.getByRole('alertdialog', {
    name: t(locale, 'settings.security.signOutAllConfirm'),
  });
  await confirm.getByRole('button', { name: t(locale, 'settings.security.signOutAll') }).click();
  await expect(page).toHaveURL(appUrl(`/${locale}/login`), { timeout: 15_000 });
});

test('onboarding checklist shows 2/5 after email verification and phone verification', async ({
  page,
  uiLocale: locale,
}) => {
  const user = await seedUser();
  await uiLogin(page, locale, user);
  await page.goto(`/${locale}/app/settings/verification`);

  // Phone verification completes the "profile" item (first/last name already set at signup).
  await page
    .getByLabel(t(locale, 'settings.verification.phoneNumber'), { exact: true })
    .fill('+21620123456');
  await page.getByRole('button', { name: t(locale, 'settings.verification.sendOtp') }).click();
  const mail = await waitForEmail(user.email, PHONE_OTP_HINT);
  const otp = extractOtpCode(mail.text);
  await page.getByLabel(t(locale, 'settings.verification.otpCode'), { exact: true }).fill(otp);
  await page.getByRole('button', { name: t(locale, 'settings.verification.verifyOtp') }).click();
  // Wait for the server to record the verification: navigating earlier can render the
  // dashboard checklist from the pre-verification state (flaky under full-suite load).
  await expect(page.getByTestId('tick-PHONE')).toBeVisible();

  await page.goto(`/${locale}/app`);
  // "Votre espace est prêt à {done}/{total}" — the checklist counts the two done items.
  await expect(page.getByTestId('onboarding-checklist')).toContainText('2/5');
});
