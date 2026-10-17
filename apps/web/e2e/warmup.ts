import { E2E_PROD } from './helpers';
import { seedSuperAdmin } from './helpers/super-admin';

const BASE = 'http://localhost:3000';
const API = 'http://localhost:3001';

/**
 * GlobalSetup: in dev mode, GET every auth/app route once so `next dev` compiles them before
 * parallel workers hit them (concurrent cold compiles of the same route race — "Unexpected end of
 * JSON input"); the production build (`E2E_PROD`) has nothing to compile. Then seed the
 * throwaway super-admin the smoke spec drives (plan Task 23) and expose its credentials to every
 * worker through `process.env`.
 */
export default async function warmup() {
  // Wait for the dev server and the API (webServer may start before or after this).
  await poll(`${BASE}/fr`);
  await poll(`${API}/health/live`);
  if (!E2E_PROD) await warmRoutes();

  // The smoke spec (e2e/smoke.spec.ts) logs in as this super-admin; unique per run.
  const admin = await seedSuperAdmin();
  process.env.E2E_SUPER_ADMIN_EMAIL = admin.email;
  process.env.E2E_SUPER_ADMIN_PASSWORD = admin.password;
  process.env.E2E_SUPER_ADMIN_TOTP_SECRET = admin.secret;
}

async function warmRoutes() {
  const routes = [
    '/',
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
    '/fr/app/settings/profile',
    '/fr/app/settings/verification',
    '/fr/app/settings/security',
    // Compiles the [wid] workspace tree (redirects to login, but the route is compiled).
    '/fr/app/w/00000000-0000-0000-0000-000000000000',
    '/fr/app/w/00000000-0000-0000-0000-000000000000/members',
    '/fr/app/w/00000000-0000-0000-0000-000000000000/audit-log',
    // Compiles the super-admin console (404 for anonymous, but the route tree is compiled).
    '/fr/admin',
    '/fr/admin/workspaces',
    '/fr/admin/abuse-reports',
    '/fr/admin/abuse-reports/00000000-0000-0000-0000-000000000000',
    '/fr/admin/health',
  ];
  for (const route of routes) {
    // Best effort: a reset while the dev server compiles must not abort globalSetup —
    // the second attempt re-warms the route; if it still fails, it just stays cold.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await fetch(`${BASE}${route}`, { redirect: 'manual' });
        break;
      } catch {
        if (attempt === 1) {
          console.warn(`warmup: ${route} never answered`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
}

/** Poll a URL every 250 ms until it answers anything below 500 (or give up after 120 s). */
async function poll(url: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} never came up`);
}
