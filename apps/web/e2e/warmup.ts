const BASE = 'http://localhost:3000';

/**
 * GET every auth/app route once so `next dev` compiles them before parallel workers hit them:
 * concurrent cold compiles of the same route race ("Unexpected end of JSON input").
 * Order-independent: polls until the server answers (webServer may start before or after this).
 */
export default async function warmup() {
  // Wait for the dev server (webServer readiness only probes /fr).
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const res = await fetch(`${BASE}/fr`, { redirect: 'manual' });
      if (res.status < 500) break;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const routes = [
    '/fr',
    '/fr/login',
    '/fr/register',
    '/fr/verify-email',
    '/fr/forgot-password',
    '/fr/reset-password',
    '/fr/2fa',
    '/fr/2fa/setup',
    '/fr/app',
  ];
  for (const route of routes) {
    await fetch(`${BASE}${route}`, { redirect: 'manual' });
  }
}
