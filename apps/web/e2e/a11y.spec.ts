import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test, uiLogin } from './helpers';
import { joinByInvitation, seedUser } from './helpers/seed';

/**
 * Spec §8 / audit #15: axe WCAG 2 A/AA on the main pages, in the project's locale (fr, ar) on
 * desktop and mobile. Serious and critical violations fail the test; each page is also captured
 * full-page under `test-results/screens/{project}/` for the RTL recette (CI artefact
 * `rtl-screens`).
 */

const BLOCKING = ['serious', 'critical'];

async function audit(page: Page, testInfo: TestInfo, name: string) {
  await expect(page.getByRole('main').first()).toBeVisible();
  // Skeletons are aria-hidden placeholders: audit the loaded page, not the loading state.
  await expect(page.locator('.animate-pulse')).toHaveCount(0);
  await page.screenshot({
    path: `test-results/screens/${testInfo.project.name}/${name}.png`,
    fullPage: true,
  });
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const blocking = violations
    .filter((v) => BLOCKING.includes(v.impact ?? ''))
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
  expect(blocking, `${name}: serious/critical axe violations`).toEqual([]);
}

test.describe('accessibility (axe wcag2a/aa)', () => {
  test('public pages: landing, login, register', async ({ page, uiLocale: locale }, testInfo) => {
    await page.goto(`/${locale}`);
    await audit(page, testInfo, 'landing');
    await page.goto(`/${locale}/login`);
    await audit(page, testInfo, 'login');
    await page.goto(`/${locale}/register`);
    await audit(page, testInfo, 'register');
  });

  test('app pages as an organisation owner: home, profile, members, audit log', async ({
    page,
    uiLocale: locale,
  }, testInfo) => {
    // A verified owner (D-O6) invites the teacher, who joins through the invitation.
    const owner = await seedUser({ totp: true, organization: true, verifiedTeacher: true });
    const member = await seedUser();
    const wid = owner.orgWorkspaceId!;
    await joinByInvitation(owner, wid, member, 'TEACHER');
    await uiLogin(page, locale, owner);
    await audit(page, testInfo, 'app');
    await page.goto(`/${locale}/app/settings/profile`);
    await audit(page, testInfo, 'settings-profile');
    await page.goto(`/${locale}/app/w/${wid}/members`);
    await expect(page.getByRole('table')).toBeVisible();
    await audit(page, testInfo, 'members');
    await page.goto(`/${locale}/app/w/${wid}/audit-log`);
    await expect(page.getByRole('table')).toBeVisible();
    await audit(page, testInfo, 'audit-log');
  });

  test('super-admin console: workspaces', async ({ page, uiLocale: locale }, testInfo) => {
    const admin = {
      email: process.env.E2E_SUPER_ADMIN_EMAIL ?? '',
      password: process.env.E2E_SUPER_ADMIN_PASSWORD ?? '',
      secret: process.env.E2E_SUPER_ADMIN_TOTP_SECRET ?? '',
    };
    expect(admin.email, 'globalSetup (e2e/warmup.ts) seeds the super-admin').not.toBe('');
    await uiLogin(page, locale, admin);
    await page.goto(`/${locale}/admin/workspaces`);
    await expect(page.getByRole('table')).toBeVisible();
    await audit(page, testInfo, 'admin-workspaces');
  });
});
