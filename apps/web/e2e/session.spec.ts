import { appUrl, expect, fillLogin, t, test, toast, uiLogin } from './helpers';
import { seedUser } from './helpers/seed';
import { totpCode } from './helpers/totp';

/** Review Focus 1 / audit #1: the 15-minute access cookie must not end the session. */

test('access cookie expiry is transparent: server navigation and client call both refresh', async ({
  page,
  context,
  uiLocale: locale,
}) => {
  const user = await seedUser({ acceptConsents: true });
  await uiLogin(page, locale, user);

  // Simulate the 15-minute expiry, then a server navigation: (app) layout -> /auth/resume -> back.
  await context.clearCookies({ name: 'nibras_access' });
  await page.goto(`/${locale}/app/settings/profile`);
  await expect(page).toHaveURL(appUrl(`/${locale}/app/settings/profile`), { timeout: 15_000 });
  expect((await context.cookies()).some((c) => c.name === 'nibras_access')).toBe(true);

  // Again, then a client call: 401 -> one refresh -> the PATCH is retried with its body.
  await context.clearCookies({ name: 'nibras_access' });
  const refreshes: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/v1/auth/refresh')) refreshes.push(r.url());
  });
  await page.getByRole('button', { name: t(locale, 'settings.profile.save') }).click();
  await expect(toast(page, locale, t(locale, 'settings.profile.saved'))).toBeVisible();
  expect(refreshes).toHaveLength(1);
});

test('anonymous visitor on /app lands on login with next, without a redirect loop', async ({
  page,
  uiLocale: locale,
}) => {
  await page.goto(`/${locale}/app/settings/security`);
  await expect(page).toHaveURL(appUrl(`/${locale}/login?next=%2Fapp%2Fsettings%2Fsecurity`), {
    timeout: 15_000,
  });
  await expect(page.getByRole('heading', { name: t(locale, 'auth.login.title') })).toBeVisible();
});

test('login with ?next and 2FA keeps the deep link and remember', async ({
  page,
  context,
  uiLocale: locale,
}) => {
  const user = await seedUser({ totp: true, acceptConsents: true });
  await page.goto(`/${locale}/login?next=%2Fapp%2Fsettings%2Fsecurity`);
  await page.getByLabel(t(locale, 'auth.login.remember'), { exact: true }).check();
  await fillLogin(page, locale, user.email, user.password);
  await expect(page).toHaveURL(appUrl(`/${locale}/2fa`), { timeout: 15_000 });
  await page
    .getByLabel(t(locale, 'auth.twoFactor.code'), { exact: true })
    .fill(totpCode(user.secret!));
  await page.getByRole('button', { name: t(locale, 'auth.twoFactor.submit') }).click();
  await expect(page).toHaveURL(appUrl(`/${locale}/app/settings/security`), { timeout: 15_000 });

  // "Se souvenir de moi" survives the 2FA step: the refresh cookie is persistent.
  const refresh = (await context.cookies()).find((c) => c.name === 'nibras_refresh');
  expect(refresh?.expires ?? -1).toBeGreaterThan(0);
});

test('an unsafe ?next is ignored after login', async ({ page, uiLocale: locale }) => {
  const user = await seedUser({ acceptConsents: true });
  await page.goto(`/${locale}/login?next=%2F%5Cevil.example`);
  await fillLogin(page, locale, user.email, user.password);
  await expect(page).toHaveURL(appUrl(`/${locale}/app`), { timeout: 15_000 });
});

test('logout from the user menu clears the session', async ({
  page,
  context,
  uiLocale: locale,
}) => {
  const user = await seedUser({ acceptConsents: true });
  await uiLogin(page, locale, user);
  await page
    .getByRole('button', { name: t(locale, 'shell.userMenu').replace('{name}', '').trim() })
    .click();
  await page.getByRole('menuitem', { name: t(locale, 'shell.logout') }).click();
  await expect(page).toHaveURL(appUrl(`/${locale}/login`), { timeout: 15_000 });
  const names = (await context.cookies()).map((c) => c.name);
  expect(names).not.toContain('nibras_access');
  expect(names).not.toContain('nibras_refresh');
  // Back to the app: no session left, so the layout sends the visitor to login again.
  await page.goto(`/${locale}/app`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/login\\?next=`), { timeout: 15_000 });
});
