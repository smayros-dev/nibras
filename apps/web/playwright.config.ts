import { defineConfig, devices } from '@playwright/test';
import type { LocaleTestOptions } from './e2e/helpers';
import { TEST_CONSENT_TERMS_VERSION } from './e2e/helpers';

const baseURL = 'http://localhost:3000';

export default defineConfig<LocaleTestOptions>({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // Compiles every auth route up front (parallel workers racing cold compiles crash `next dev`).
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
    // The hello spec parameterises locales itself; only it runs on a real mobile viewport.
    // The smoke runs FR + AR sequentially inside one test (plan Task 23): two parallel journeys
    // starve the dev servers.
    {
      name: 'mobile-fr',
      use: { ...devices['Pixel 7'], uiLocale: 'fr' },
      testMatch: /hello\.spec\.ts|smoke\.spec\.ts/,
    },
  ],
  // The API runs with a bumped TERMS version (consent-gate e2e); registration still grants the
  // static CONSENT_VERSIONS, so every signed-up user has one pending consent.
  webServer: [
    {
      command: 'pnpm --filter @tt/api dev',
      url: 'http://localhost:3001/health/live',
      reuseExistingServer: true,
      timeout: 180_000,
      env: {
        TEST_CONSENT_TERMS_VERSION,
        // The suite seeds many accounts and logs in from one ip: the production anon limit
        // (60/min) would 429 the parallel workers. The login throttle still guards passwords.
        RATE_LIMIT_ANON: '10000',
      },
    },
    {
      command: 'pnpm --filter @tt/worker dev',
      url: 'http://localhost:3002/health/live',
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: 'pnpm --filter @tt/web dev',
      // Probing a page (not /health) compiles the [locale] route before parallel workers hit it:
      // concurrent cold compiles in `next dev` can race ("Unexpected end of JSON input").
      url: `${baseURL}/fr`,
      reuseExistingServer: true,
      timeout: 180_000,
      // The (app) layout reads it server-side to compute the current TERMS version.
      env: { TEST_CONSENT_TERMS_VERSION },
    },
  ],
});
