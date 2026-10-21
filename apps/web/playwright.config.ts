import { defineConfig, devices } from '@playwright/test';
import type { LocaleTestOptions } from './e2e/helpers';
import { TEST_CONSENT_TERMS_VERSION } from './e2e/helpers';

const baseURL = 'http://localhost:3000';
const ci = !!process.env.CI;
/**
 * Production-build mode (spec D11): in CI, or locally with `E2E_PROD=1` after
 * `pnpm --filter @nibras/web build`, the web app is the standalone server the container runs (the
 * service worker registers, the CSP is the strict one, no cold compiles). The API and worker run
 * their builds too (`pnpm build` first): a `nest start --watch` server restarts whenever its
 * watcher sees a change, and requests in flight then fail with a 500 through the web proxy.
 * Locally the API reads the root `.env` through dotenv-cli (as its dev script does); the worker
 * loads it itself. CI has no `.env`: the job env carries everything, and the logs go to files.
 */
const prod = ci || process.env.E2E_PROD === '1';

function apiCommand(): string {
  if (ci) return 'pnpm --filter @nibras/api start > ../../api.log 2>&1';
  if (prod) return 'pnpm --filter @nibras/api exec dotenv -e ../../.env -- node dist/main.js';
  return 'pnpm --filter @nibras/api dev';
}

function workerCommand(): string {
  if (ci) return 'pnpm --filter @nibras/worker start > ../../worker.log 2>&1';
  return prod ? 'pnpm --filter @nibras/worker start' : 'pnpm --filter @nibras/worker dev';
}

export default defineConfig<LocaleTestOptions>({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: ci ? 1 : 0,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  expect: { timeout: 10_000 },
  // Dev mode: compiles every route up front (parallel workers racing cold compiles crash
  // `next dev`). Both modes: seeds the super-admin.
  globalSetup: './e2e/warmup',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-fr',
      use: { ...devices['Desktop Chrome'], uiLocale: 'fr' },
      // The full-journey smoke runs on the mobile projects, once per locale (plan Task 23).
      testIgnore: /smoke\.spec\.ts/,
    },
    {
      name: 'chromium-ar',
      use: { ...devices['Desktop Chrome'], uiLocale: 'ar' },
      testIgnore: /smoke\.spec\.ts/,
    },
    // The landing spec parameterises locales itself; it and the shell spec (bottom nav, More sheet)
    // run on a real mobile viewport.
    // The smoke runs FR + AR sequentially inside one test (plan Task 23): two parallel journeys
    // starve the dev servers.
    {
      name: 'mobile-fr',
      use: { ...devices['Pixel 7'], uiLocale: 'fr' },
      testMatch: /landing\.spec\.ts|smoke\.spec\.ts|shell\.spec\.ts|a11y\.spec\.ts/,
    },
    // RTL on a phone (spec §8): shell (bottom nav, More sheet), axe + screenshots, PWA, the media
    // watermark (SP3 AC-MED-09). The landing and smoke specs already cover ar themselves (they
    // iterate the locales), so they are not run twice.
    {
      name: 'mobile-ar',
      use: { ...devices['Pixel 7'], uiLocale: 'ar' },
      testMatch: /shell\.spec\.ts|a11y\.spec\.ts|pwa\.spec\.ts|watermark\.spec\.ts/,
    },
  ],
  // The API runs with a bumped TERMS version (consent-gate e2e); registration still grants the
  // static CONSENT_VERSIONS, so every signed-up user has one pending consent.
  webServer: [
    {
      command: apiCommand(),
      url: 'http://localhost:3001/health/live',
      reuseExistingServer: !ci,
      timeout: 180_000,
      env: {
        TEST_CONSENT_TERMS_VERSION,
        // The override is honoured only under APP_ENV=development (`testConsentTermsVersion`).
        APP_ENV: 'development',
        // The suite seeds many accounts and logs in from one ip: the production anon limit
        // (60/min) would 429 the parallel workers. The login throttle still guards passwords.
        RATE_LIMIT_ANON: '10000',
      },
    },
    {
      command: workerCommand(),
      url: 'http://localhost:3002/health/live',
      reuseExistingServer: !ci,
      timeout: 180_000,
    },
    {
      command: prod
        ? 'pnpm --filter @nibras/web start:standalone'
        : 'pnpm --filter @nibras/web dev',
      // Probing a page (not /health) compiles the [locale] route before parallel workers hit it:
      // concurrent cold compiles in `next dev` can race ("Unexpected end of JSON input").
      url: `${baseURL}/fr`,
      reuseExistingServer: !ci,
      timeout: 180_000,
      // The (app) layout reads it server-side to compute the current TERMS version. The override
      // is honoured only under an explicit APP_ENV=development, whatever NODE_ENV says (the
      // standalone build runs NODE_ENV=production) — `testConsentTermsVersion`, @nibras/contracts.
      // MEDIA_ORIGINS: the CSP media origins (MinIO: presigned upload PUTs, the PDF fetch, video
      // playback). `next dev` also reads it from the root `.env` (next.config.ts); the standalone
      // server only gets its env from here or CI's job env.
      env: {
        TEST_CONSENT_TERMS_VERSION,
        APP_ENV: 'development',
        MEDIA_ORIGINS: process.env.MEDIA_ORIGINS ?? 'http://localhost:9000',
      },
    },
  ],
});
