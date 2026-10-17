import { expect, test } from '@playwright/test';
import { messages } from '@tt/i18n';
import { t } from './helpers';

/**
 * A raw `namespace.key` message id rendered instead of its translation. The namespaces are the
 * reference catalogue's (`fr`) top-level keys, so new ones are covered without editing this test.
 */
const RAW_KEY = new RegExp(`\\b(${Object.keys(messages.fr).join('|')})\\.[A-Za-z_]+\\b`);

for (const [locale, dir] of [
  ['fr', 'ltr'],
  ['ar', 'rtl'],
  ['en', 'ltr'],
] as const) {
  test(`landing page in ${locale}`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('html')).toHaveAttribute('dir', dir);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t(locale, 'landing.title'));
    expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe(dir);
    // Anonymous visitor: both CTAs lead to the auth screens.
    await expect(page.getByRole('link', { name: t(locale, 'landing.login') })).toHaveAttribute(
      'href',
      `/${locale}/login`,
    );
    await expect(page.getByRole('link', { name: t(locale, 'landing.register') })).toHaveAttribute(
      'href',
      `/${locale}/register`,
    );
    for (const n of [1, 2, 3]) {
      await expect(
        page.getByRole('heading', { level: 3, name: t(locale, `landing.value${n}Title`) }),
      ).toBeVisible();
    }
    const raw = await page.locator('body').innerText();
    expect(raw).not.toMatch(RAW_KEY); // no raw message keys in text
    // ...nor in accessible names / tooltips (client components included: Review Focus 2).
    const attributes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[aria-label], [title]')).flatMap((el) =>
        ['aria-label', 'title'].map((name) => el.getAttribute(name) ?? ''),
      ),
    );
    expect(attributes.length).toBeGreaterThan(0);
    expect(attributes.filter((value) => RAW_KEY.test(value))).toEqual([]);
  });
}

// Review Focus 1: a regional subtag (ar-TN, fr-FR, en-US) must match its language, not fall
// through to the default; an unsupported language (de-DE) lands on the default /fr.
test('Accept-Language negotiation', async ({ browser }) => {
  const cases = [
    ['ar-TN,fr;q=0.8', '/ar'],
    ['fr-FR,fr;q=0.9', '/fr'],
    ['de-DE', '/fr'],
    ['en-US,en;q=0.9', '/en'],
  ] as const;
  for (const [header, path] of cases) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'Accept-Language': header } });
    // Chromium replaces Accept-Language on navigations with the context locale (en-US), ignoring
    // extraHTTPHeaders; force the exact header so the server really negotiates this value.
    await ctx.route('**/*', (route) =>
      route.continue({ headers: { ...route.request().headers(), 'accept-language': header } }),
    );
    const page = await ctx.newPage();
    await page.goto('/');
    expect(new URL(page.url()).pathname, `Accept-Language: ${header}`).toBe(path);
    await ctx.close();
  }
});

test('web health route', async ({ request }) => {
  const r = await request.get('/health');
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ status: 'ok' });
});

for (const path of ['/health/live', '/health/ready']) {
  test(`web ${path} is served outside locale routing`, async ({ request }) => {
    const r = await request.get(path, { maxRedirects: 0 });
    expect(r.status()).toBe(200);
    expect(await r.json()).toEqual({ status: 'ok' });
  });
}

test('locale menu switches the landing to ar and flips direction', async ({ page }) => {
  await page.goto('/fr');
  await page
    .getByRole('button', { name: t('fr', 'shell.language') })
    .first()
    .click();
  await page.getByRole('menuitemradio', { name: 'العربية' }).click();
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('ar', 'landing.title'));
});

test('mobile: 16px inline gutter and no horizontal scroll at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const locale of ['fr', 'ar', 'en']) {
    await page.goto(`/${locale}`);
    const layout = await page.evaluate(() => {
      // The gutter is the landing container's `padding-inline`, inside a full-width <main>.
      const container = document.querySelector<HTMLElement>('#main [data-landing-container]')!;
      const style = getComputedStyle(container);
      const box = container.getBoundingClientRect();
      return {
        paddingStart: style.paddingInlineStart,
        paddingEnd: style.paddingInlineEnd,
        boxStart: box.left,
        boxEnd: document.documentElement.clientWidth - box.right,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    expect(layout.paddingStart).toBe('16px');
    expect(layout.paddingEnd).toBe('16px');
    expect(layout.boxStart).toBe(0);
    expect(layout.boxEnd).toBe(0);
    expect(layout.scrollWidth, `horizontal overflow in ${locale}`).toBeLessThanOrEqual(
      layout.clientWidth,
    );
  }
});
