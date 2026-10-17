import { appUrl, expect, t, test, uiLogin } from './helpers';
import { seedUser } from './helpers/seed';

/** Spec §5, audit #2/#4, Review Focus 2: the shell links resolve, logout works, RTL and theme. */

/** A raw `namespace.key` message id rendered instead of its translation. */
const RAW_KEY =
  /\b(?:common|nav|shell|theme|errorPages|app|settings|workspace|admin|legal)\.[a-zA-Z]+/;

test('every nav link resolves (no 404) and the current item is marked', async ({
  page,
  isMobile,
  uiLocale: locale,
}) => {
  test.skip(isMobile, 'the sidebar is hidden below lg');
  const user = await seedUser({ organization: true, totp: true });
  await uiLogin(page, locale, user);
  // Inside the organisation, so the workspace section is listed too.
  await page.goto(`/${locale}/app/w/${user.orgWorkspaceId}/members`);
  const nav = page.getByRole('navigation', { name: t(locale, 'nav.primaryNav') });
  await expect(nav.getByRole('link', { name: t(locale, 'workspace.navMembers') })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const hrefs = await nav
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  expect(hrefs.length).toBeGreaterThanOrEqual(6);
  for (const href of hrefs) {
    expect(href.startsWith(`/${locale}/`), href).toBe(true);
    const response = await page.goto(href);
    expect(response?.status(), href).toBe(200);
    await expect(page).toHaveURL(appUrl(href), { timeout: 15_000 });
    expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);
    await expect(
      page
        .getByRole('navigation', { name: t(locale, 'nav.primaryNav') })
        .locator('a[aria-current="page"]'),
    ).toHaveAttribute('href', href);
  }
});

test('client navigation: clicking nav links moves aria-current without a page load', async ({
  page,
  isMobile,
  uiLocale: locale,
}) => {
  test.skip(isMobile, 'the sidebar is hidden below lg');
  const user = await seedUser({ organization: true, totp: true });
  await uiLogin(page, locale, user);
  await page.goto(`/${locale}/app/settings/profile`);
  // Survives client navigations only: a full page load would drop it.
  await page.evaluate(() => {
    (window as unknown as { __ttNoReload?: boolean }).__ttNoReload = true;
  });
  const nav = page.getByRole('navigation', { name: t(locale, 'nav.primaryNav') });
  // By href: "Paramètres" also names the workspace settings item once a workspace is open.
  const settings = nav.locator(`a[href="/${locale}/app/settings/profile"]`);
  const workspaces = nav.getByRole('link', { name: t(locale, 'nav.workspaces') });
  await expect(settings).toHaveAttribute('aria-current', 'page');

  await workspaces.click();
  await expect(page).toHaveURL(appUrl(`/${locale}/app/settings/workspaces`), { timeout: 15_000 });
  await expect(workspaces).toHaveAttribute('aria-current', 'page');
  await expect(settings).not.toHaveAttribute('aria-current', 'page');

  await settings.click();
  await expect(page).toHaveURL(appUrl(`/${locale}/app/settings/profile`), { timeout: 15_000 });
  await expect(settings).toHaveAttribute('aria-current', 'page');
  await expect(workspaces).not.toHaveAttribute('aria-current', 'page');

  // The switcher navigates client-side too, and the workspace section follows the path.
  const orgSettings = nav.locator(`a[href="/${locale}/app/w/${user.orgWorkspaceId}"]`);
  await expect(orgSettings).toHaveCount(0);
  await page.getByRole('button', { name: t(locale, 'nav.currentWorkspace') }).click();
  await page.getByRole('menuitemradio', { name: /École Test/ }).click();
  await expect(page).toHaveURL(appUrl(`/${locale}/app/w/${user.orgWorkspaceId}`), {
    timeout: 15_000,
  });
  await expect(orgSettings).toHaveAttribute('aria-current', 'page');
  await expect(settings).not.toHaveAttribute('aria-current', 'page');

  expect(
    await page.evaluate(() => (window as unknown as { __ttNoReload?: boolean }).__ttNoReload),
  ).toBe(true);
});

test('user menu logs out', async ({ page, uiLocale: locale }) => {
  const user = await seedUser();
  await uiLogin(page, locale, user);
  await page
    .getByRole('button', { name: t(locale, 'shell.userMenu').replace('{name}', '').trim() })
    .click();
  await page.getByRole('menuitem', { name: t(locale, 'shell.logout') }).click();
  await expect(page).toHaveURL(appUrl(`/${locale}/login`), { timeout: 15_000 });
  const me = await page.request.get('/api/v1/me');
  expect(me.status()).toBe(401);
});

test('mobile: bottom nav with More sheet; sidebar hidden', async ({
  page,
  isMobile,
  uiLocale: locale,
}) => {
  test.skip(!isMobile, 'mobile project only');
  const user = await seedUser({ organization: true, totp: true });
  await uiLogin(page, locale, user);
  await page.goto(`/${locale}/app/w/${user.orgWorkspaceId}`);
  await expect(page.getByRole('navigation', { name: t(locale, 'nav.primaryNav') })).toBeHidden();
  const bottom = page.getByRole('navigation', { name: t(locale, 'nav.secondaryNav') });
  await expect(bottom).toBeVisible();
  await expect(bottom.getByRole('link', { name: t(locale, 'nav.settings') })).toBeVisible();
  await bottom.getByRole('button', { name: t(locale, 'nav.more') }).click();
  const sheet = page.getByRole('dialog', { name: t(locale, 'nav.more') });
  await expect(sheet.getByRole('link', { name: t(locale, 'workspace.navMembers') })).toBeVisible();
  await expect(sheet.getByRole('button', { name: t(locale, 'shell.logout') })).toBeVisible();
  await expect(sheet.getByRole('button', { name: t(locale, 'shell.language') })).toBeVisible();
  // The main content clears the fixed bottom nav.
  const gap = await page.evaluate(() => {
    const main = document.getElementById('main')!;
    return parseFloat(getComputedStyle(main).paddingBottom);
  });
  expect(gap).toBeGreaterThanOrEqual(64);
});

test('rtl: the sidebar is on the right side of the viewport in ar', async ({
  page,
  isMobile,
  uiLocale: locale,
}) => {
  test.skip(locale !== 'ar' || isMobile, 'desktop ar only');
  const user = await seedUser();
  await uiLogin(page, locale, user);
  const box = await page.getByRole('navigation', { name: t('ar', 'nav.primaryNav') }).boundingBox();
  expect(box!.x).toBeGreaterThan(page.viewportSize()!.width / 2);
});

test('dark theme persists across navigation and the html carries data-theme', async ({
  page,
  isMobile,
  uiLocale: locale,
}) => {
  test.skip(isMobile, 'the theme toggle is in the More sheet below lg');
  const user = await seedUser();
  await uiLogin(page, locale, user);
  await page.getByRole('button', { name: new RegExp(`^${t(locale, 'theme.toggle')}`) }).click();
  await page.getByRole('menuitemradio', { name: t(locale, 'theme.dark') }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto(`/${locale}/app/settings/profile`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(
    page.getByRole('button', {
      name: t(locale, 'theme.toggleCurrent').replace('{theme}', t(locale, 'theme.dark')),
    }),
  ).toBeVisible();
});

test('404 and error pages are translated and rtl in ar', async ({ page, uiLocale: locale }) => {
  await page.goto(`/${locale}/does-not-exist`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    t(locale, 'errorPages.notFoundTitle'),
  );
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);
});
