import { request as playwrightRequest } from '@playwright/test';
import { appUrl, t, test, uiLogin, apiLogin, expect } from './helpers';
import { addOrgMember, seedUser } from './helpers/seed';
import { seedSuperAdmin } from './helpers/super-admin';

const BASE = 'http://localhost:3000';

test.describe('super-admin console (plan Task 22)', () => {
  test('super-admin suspends a workspace from the console; member sees the banner', async ({
    browser,
    uiLocale: locale,
  }) => {
    const orgName = `Admin WS ${Date.now()}`;
    const owner = await seedUser({ organization: true, totp: true, organizationName: orgName });
    const admin = await seedSuperAdmin();

    const adminContext = await browser.newContext();
    try {
      const adminPage = await adminContext.newPage();
      await uiLogin(adminPage, locale, admin);
      await adminPage.goto(`/${locale}/admin/workspaces`);
      await adminPage
        .getByLabel(t(locale, 'admin.workspaces.search'), { exact: true })
        .fill(orgName);
      const row = adminPage.getByRole('row').filter({ hasText: orgName });
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: t(locale, 'admin.workspaces.suspend') }).click();
      await adminPage
        .getByLabel(t(locale, 'admin.workspaces.reason'), { exact: true })
        .fill('Suspension depuis la console');
      await adminPage.getByRole('button', { name: t(locale, 'admin.workspaces.confirm') }).click();
      await expect(adminPage.getByRole('status')).toHaveText(
        t(locale, 'admin.workspaces.suspended'),
      );
      await expect(row.getByText(t(locale, 'admin.workspaceStatus.SUSPENDED'))).toBeVisible();
    } finally {
      await adminContext.close();
    }

    const memberContext = await browser.newContext();
    try {
      const memberPage = await memberContext.newPage();
      await uiLogin(memberPage, locale, owner);
      await memberPage.goto(`/${locale}/app/w/${owner.orgWorkspaceId}`);
      await expect(memberPage.getByRole('status')).toHaveText(t(locale, 'workspace.suspended'));
    } finally {
      await memberContext.close();
    }
  });

  test('abuse queue: MINOR_SAFETY first; resolve a report; suspend the reported teacher', async ({
    browser,
    uiLocale: locale,
  }) => {
    const owner = await seedUser({ organization: true, totp: true });
    const teacher = await seedUser();
    addOrgMember(owner.orgWorkspaceId!, teacher.userId, 'TEACHER');

    // Two reports about the same teacher, created by the owner through the workspace API.
    const ctx = await playwrightRequest.newContext({ baseURL: BASE });
    try {
      await apiLogin(ctx, owner);
      for (const category of ['MINOR_SAFETY', 'HARASSMENT'] as const) {
        const res = await ctx.post(`/api/v1/workspaces/${owner.orgWorkspaceId}/abuse-reports`, {
          data: {
            category,
            description: `Signalement e2e ${category} sur le professeur.`,
            entityType: 'USER',
            entityId: teacher.userId,
          },
        });
        if (res.status() !== 201) throw new Error(`report ${res.status()}: ${await res.text()}`);
      }
    } finally {
      await ctx.dispose();
    }

    const admin = await seedSuperAdmin();
    const adminContext = await browser.newContext();
    try {
      const page = await adminContext.newPage();
      await uiLogin(page, locale, admin);
      await page.goto(`/${locale}/admin/abuse-reports`);

      // MINOR_SAFETY is pinned first and highlighted.
      const minorRow = page
        .getByRole('row')
        .filter({ hasText: t(locale, 'abuse.category_MINOR_SAFETY') });
      await expect(minorRow.first()).toBeVisible();
      await expect(minorRow.first()).toHaveAttribute('data-minor-safety', 'true');
      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toHaveAttribute('data-minor-safety', 'true');

      // Open the HARASSMENT report, resolve it with a resolution text.
      const harassmentRow = page
        .getByRole('row')
        .filter({ hasText: t(locale, 'abuse.category_HARASSMENT') })
        .first();
      await harassmentRow.getByRole('link').first().click();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText(t(locale, 'admin.reports.description'))).toBeVisible();

      await page
        .getByLabel(t(locale, 'admin.reports.filterStatus'), { exact: true })
        .selectOption('IN_REVIEW');
      await page.getByRole('button', { name: t(locale, 'admin.reports.save') }).click();
      await expect(page.getByRole('status')).toHaveText(t(locale, 'admin.reports.saved'));

      await page
        .getByLabel(t(locale, 'admin.reports.filterStatus'), { exact: true })
        .selectOption('RESOLVED');
      await page
        .getByLabel(t(locale, 'admin.reports.resolution'), { exact: true })
        .fill('Avertissement envoyé, contenu retiré.');
      await page.getByRole('button', { name: t(locale, 'admin.reports.save') }).click();
      await expect(page.getByRole('status')).toHaveText(t(locale, 'admin.reports.saved'));
      await page.reload();
      await expect(page.getByTestId('admin-abuse-status')).toHaveText(
        t(locale, 'abuse.status_RESOLVED'),
      );

      // The reported teacher holds a teaching membership: suspend from the detail page.
      await page.getByRole('button', { name: t(locale, 'admin.reports.suspendTeacher') }).click();
      await page
        .getByLabel(t(locale, 'admin.workspaces.reason'), { exact: true })
        .fill('Comportement signalé');
      await page.getByRole('button', { name: t(locale, 'admin.workspaces.confirm') }).click();
      await expect(page.getByRole('status')).toHaveText(t(locale, 'admin.reports.userSuspended'));
    } finally {
      await adminContext.close();
    }

    // The teacher can no longer sign in (login is also rate-limited per IP: retry 429).
    const ctx2 = await playwrightRequest.newContext({ baseURL: BASE });
    try {
      let login = await ctx2.post('/api/v1/auth/login', {
        data: { email: teacher.email, password: teacher.password },
      });
      for (let attempt = 0; attempt < 5 && login.status() === 429; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        login = await ctx2.post('/api/v1/auth/login', {
          data: { email: teacher.email, password: teacher.password },
        });
      }
      expect(login.status()).toBe(403);
    } finally {
      await ctx2.dispose();
    }
  });

  test('non super-admin gets 404 on /admin', async ({ page, uiLocale: locale }) => {
    const user = await seedUser();
    await uiLogin(page, locale, user);
    const response = await page.goto(`/${locale}/admin`);
    expect(response?.status()).toBe(404);
    await expect(page).toHaveURL(appUrl(`/${locale}/admin`));
  });
});
