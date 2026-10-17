import { request as playwrightRequest } from '@playwright/test';
import { appUrl, t, test, toast, uiLogin, apiLogin, expect } from './helpers';
import { addOrgMember, seedUser } from './helpers/seed';
import { retryOn429 } from './helpers/retry';
import { seedSuperAdmin } from './helpers/super-admin';

const BASE = 'http://localhost:3000';

/** Accessible name of a console workspace-row menu (`admin.workspaces.rowActions`). */
function rowActions(locale: string, name: string): string {
  return t(locale, 'admin.workspaces.rowActions').replace('{name}', name);
}

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
      // Row menu → *Suspendre* → the reason is asked in a dialog.
      await row.getByRole('button', { name: rowActions(locale, orgName) }).click();
      await adminPage
        .getByRole('menuitem', { name: t(locale, 'admin.workspaces.suspend') })
        .click();
      const dialog = adminPage.getByRole('dialog', {
        name: t(locale, 'admin.workspaces.confirmSuspend'),
      });
      await dialog
        .getByLabel(t(locale, 'admin.workspaces.reason'), { exact: true })
        .fill('Suspension depuis la console');
      await dialog.getByRole('button', { name: t(locale, 'admin.workspaces.suspend') }).click();
      await expect(toast(adminPage, locale, t(locale, 'admin.workspaces.suspended'))).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(row.getByText(t(locale, 'admin.workspaceStatus.SUSPENDED'))).toBeVisible();
    } finally {
      await adminContext.close();
    }

    const memberContext = await browser.newContext();
    try {
      const memberPage = await memberContext.newPage();
      await uiLogin(memberPage, locale, owner);
      await memberPage.goto(`/${locale}/app/w/${owner.orgWorkspaceId}`);
      // Filtered: a route's loading fallback (also a `status`) may still be streaming out.
      await expect(
        memberPage.getByRole('status').filter({ hasText: t(locale, 'workspace.suspended') }),
      ).toHaveText(t(locale, 'workspace.suspended'));
    } finally {
      await memberContext.close();
    }
  });

  test('abuse queue: MINOR_SAFETY first; resolve a report; suspend the reported teacher', async ({
    browser,
    uiLocale: locale,
  }) => {
    // Three logins and several admin pages: under dev-server load this outgrows the default budget.
    test.slow();
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
      // The queue is global (parallel projects and earlier runs add reports): narrow it to this
      // test's workspace, or `.first()` below may pick another test's report and teacher.
      await page
        .getByLabel(t(locale, 'admin.reports.filterWorkspace'), { exact: true })
        .fill(owner.orgWorkspaceId!);
      await expect(page.locator('tbody tr')).toHaveCount(2);

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
      await expect(
        page.getByRole('heading', { name: t(locale, 'admin.reports.description'), exact: true }),
      ).toBeVisible();

      await page
        .getByLabel(t(locale, 'admin.reports.newStatus'), { exact: true })
        .selectOption('IN_REVIEW');
      await page.getByRole('button', { name: t(locale, 'admin.reports.save') }).click();
      await expect(toast(page, locale, t(locale, 'admin.reports.saved'))).toBeVisible();
      await expect(page.getByTestId('admin-abuse-status')).toHaveText(
        t(locale, 'abuse.status_IN_REVIEW'),
      );

      await page
        .getByLabel(t(locale, 'admin.reports.newStatus'), { exact: true })
        .selectOption('RESOLVED');
      await page
        .getByLabel(t(locale, 'admin.reports.resolution'), { exact: true })
        .fill('Avertissement envoyé, contenu retiré.');
      await page.getByRole('button', { name: t(locale, 'admin.reports.save') }).click();
      // The first "saved" toast may still be on screen: assert on the reloaded status instead.
      await expect(page.getByTestId('admin-abuse-status')).toHaveText(
        t(locale, 'abuse.status_RESOLVED'),
      );
      await page.reload();
      await expect(page.getByTestId('admin-abuse-status')).toHaveText(
        t(locale, 'abuse.status_RESOLVED'),
      );

      // The reported teacher holds a teaching membership: suspend from the detail page.
      await page.getByRole('button', { name: t(locale, 'admin.reports.suspendTeacher') }).click();
      const dialog = page.getByRole('dialog', {
        name: t(locale, 'admin.reports.confirmSuspendUser'),
      });
      await dialog
        .getByLabel(t(locale, 'admin.workspaces.reason'), { exact: true })
        .fill('Comportement signalé');
      await dialog.getByRole('button', { name: t(locale, 'admin.reports.suspendUser') }).click();
      await expect(toast(page, locale, t(locale, 'admin.reports.userSuspended'))).toBeVisible();
    } finally {
      await adminContext.close();
    }

    // The teacher can no longer sign in (login is also rate-limited per IP: retry 429).
    const ctx2 = await playwrightRequest.newContext({ baseURL: BASE });
    try {
      const login = await retryOn429(() =>
        ctx2.post('/api/v1/auth/login', {
          data: { email: teacher.email, password: teacher.password },
        }),
      );
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
    await expect(page).toHaveURL(appUrl(`/${locale}/admin`), { timeout: 15_000 });
  });
});
