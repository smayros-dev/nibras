import { expect, test } from '@playwright/test';

/** Security headers (T15, spec D7, Review Focus 2). */

test('html responses carry CSP with a fresh nonce and the security headers', async ({
  request,
}) => {
  const a = await request.get('/fr/login');
  const b = await request.get('/fr/login');
  const csp = a.headers()['content-security-policy'];
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("img-src 'self' data: blob:");
  expect(csp).toContain("worker-src 'self'");
  expect(csp).not.toBe(b.headers()['content-security-policy']);
  expect(a.headers()['referrer-policy']).toBe('no-referrer');
  expect(a.headers()['x-content-type-options']).toBe('nosniff');
  expect(a.headers()['x-frame-options']).toBe('DENY');
  expect(a.headers()['permissions-policy']).toContain('geolocation=()');
  if (process.env.CI)
    expect(a.headers()['strict-transport-security']).toContain('max-age=31536000');
});

test('every script tag in the document carries the response nonce and the console has no CSP violation', async ({
  page,
}) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto('/ar/login');
  const nonce = /'nonce-([^']+)'/.exec(res!.headers()['content-security-policy'] ?? '')?.[1];
  expect(nonce).toBeTruthy();
  // `el.nonce` is the IDL value (the attribute is hidden from the DOM after parse).
  const nonces = await page.$$eval('script', (els) =>
    els.map((e) => (e as HTMLScriptElement).nonce || e.getAttribute('nonce')),
  );
  expect(nonces.length).toBeGreaterThan(0);
  expect(nonces.every((n) => n === nonce)).toBe(true);
  expect(violations).toEqual([]);

  // Theme switching after hydration (next-themes) stays within the policy.
  await page.goto('/ar/register');
  await page
    .getByRole('button', { name: /thème|theme|المظهر/i })
    .first()
    .click()
    .catch(() => {});
  expect(violations).toEqual([]);
});

test('routes the proxy skips still get nosniff and referrer-policy', async ({ request }) => {
  for (const path of ['/health/live', '/manifest.webmanifest', '/icons/icon-192.png']) {
    const res = await request.get(path);
    expect(res.headers()['x-content-type-options'], path).toBe('nosniff');
    expect(res.headers()['referrer-policy'], path).toBe('no-referrer');
  }
});
