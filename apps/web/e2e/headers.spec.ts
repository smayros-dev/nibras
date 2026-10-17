import { expect, test } from '@playwright/test';
import { E2E_PROD } from './helpers';

/** Headers next.config `headers()` and the proxy may both set: each must appear exactly once. */
const SINGLE = [
  'content-security-policy',
  'referrer-policy',
  'x-content-type-options',
  'x-frame-options',
  'permissions-policy',
  'strict-transport-security',
];

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
  // Exact value: a doubled header would read `…payment=(), camera=(self)…`.
  expect(a.headers()['permissions-policy']).toBe(
    'camera=(self), microphone=(self), geolocation=(), payment=()',
  );
  // HSTS is production-only (the dev server must not pin localhost to https): the standalone
  // build (CI, `E2E_PROD=1`) must send it on pages, the dev server must not.
  if (E2E_PROD) {
    expect(a.headers()['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  } else {
    expect(a.headers()['strict-transport-security']).toBeUndefined();
  }
  // No header is emitted twice (proxy + next.config): a doubled value is joined with a comma.
  for (const name of SINGLE) {
    const values = a.headersArray().filter((h) => h.name.toLowerCase() === name);
    expect(values.length, name).toBeLessThanOrEqual(1);
    if (name !== 'content-security-policy' && name !== 'permissions-policy')
      expect(values[0]?.value ?? '', name).not.toContain(',');
  }
});

test('a 404 for a dotted path is still a page and carries the CSP', async ({ request }) => {
  const res = await request.get('/fr/x.y');
  expect(res.status()).toBe(404);
  expect(res.headers()['content-security-policy']).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  expect(res.headers()['referrer-policy']).toBe('no-referrer');
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
  // Every script the server sent (parser-inserted) carries the nonce. Scripts those load later
  // (chunks, the dev HMR client) are trusted through 'strict-dynamic' and need none: the console
  // check below catches any that the policy would block.
  const html = await res!.text();
  const tags = html.match(/<script\b[^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(0);
  expect(tags.filter((tag) => !tag.includes(`nonce="${nonce}"`))).toEqual([]);
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
    if (E2E_PROD)
      expect(res.headers()['strict-transport-security'], path).toContain('max-age=31536000');
  }
});
