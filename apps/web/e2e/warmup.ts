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
    '/fr/app/settings/workspaces',
    // Compiles the [wid] workspace tree (redirects to login, but the route is compiled).
    '/fr/app/w/00000000-0000-0000-0000-000000000000',
    // Compiles the super-admin console (404 for anonymous, but the route tree is compiled).
    '/fr/admin',
    '/fr/admin/workspaces',
    '/fr/admin/abuse-reports',
    '/fr/admin/health',
  ];
  for (const route of routes) {
    await fetch(`${BASE}${route}`, { redirect: 'manual' });
  }
}
