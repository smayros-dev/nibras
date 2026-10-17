import { expect, test } from '@playwright/test';
import { BRAND } from '@tt/ui/brand';
import { t } from './helpers';

/** PWA (spec D6, Review Focus 5): manifest, service worker script, translated offline page. */

test('manifest is served with icons and the brand name', async ({ request }) => {
  const r = await request.get('/manifest.webmanifest');
  expect(r.status()).toBe(200);
  const m = await r.json();
  expect(m.icons.length).toBeGreaterThanOrEqual(3);
  expect(m.name).toBe(BRAND.name);
  for (const icon of m.icons as { src: string }[]) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  }
});

test('sw.js is served same-origin with no-cache', async ({ request }) => {
  const r = await request.get('/sw.js');
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toContain('javascript');
  expect(r.headers()['cache-control']).toContain('no-cache');
});

test('offline page renders translated in ar/rtl', async ({ page }) => {
  await page.goto('/ar/offline');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('ar', 'pwa.offlineTitle'));
  await expect(page.getByRole('button', { name: t('ar', 'pwa.retry') })).toBeVisible();
});

test('with the service worker installed, an offline navigation shows the offline page', async ({
  page,
  context,
}) => {
  test.skip(
    !process.env.CI && !process.env.E2E_PROD,
    'service worker registers only on production builds',
  );
  await page.goto('/ar');
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
    timeout: 15_000,
  });
  await context.setOffline(true);
  await page.goto('/ar/app').catch(() => {});
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('ar', 'pwa.offlineTitle'));
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await context.setOffline(false);
});
