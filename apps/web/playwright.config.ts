import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'pnpm --filter @tt/web dev',
    // Probing a page (not /health) compiles the [locale] route before parallel workers hit it:
    // concurrent cold compiles in `next dev` can race ("Unexpected end of JSON input").
    url: `${baseURL}/fr`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
