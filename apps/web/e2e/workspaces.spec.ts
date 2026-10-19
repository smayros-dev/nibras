import { request as playwrightRequest } from '@playwright/test';
import { apiLogin, appUrl, t, test, toast, uiLogin, expect } from './helpers';
import { addOrgMember, seedUser } from './helpers/seed';
import { suspendWorkspaceAsSuperAdmin } from './helpers/super-admin';

/** Accessible name of a members-table row menu (`members.rowActions`). */
function rowActions(locale: string, name: string): string {
  return t(locale, 'members.rowActions').replace('{name}', name);
}

test.describe('workspaces (plan Task 21)', () => {
  test('AC-WS-01 UI: create an organisation, switch to it from the switcher', async ({
    page,
    uiLocale: locale,
  }) => {
    // Creating an organisation makes its owner an OWNER (2FA mandatory from the next request).
    const user = await seedUser({ totp: true });
    await uiLogin(page, locale, user);

    // The create page is reachable from its settings nav tab (plan T20: "Espaces" is live).
    await page.goto(`/${locale}/app/settings/profile`);
    await page
      .getByRole('tab', { name: t(locale, 'settings.nav.workspaces'), exact: true })
      .click();
    await expect(page).toHaveURL(appUrl(`/${locale}/app/settings/workspaces`));
    await page.getByLabel(t(locale, 'workspace.name'), { exact: true }).fill('École E2E');
    await page.getByLabel(t(locale, 'workspace.country'), { exact: true }).selectOption('TN');
    await page.getByRole('button', { name: t(locale, 'workspace.submitOrganization') }).click();
    await expect(toast(page, locale, t(locale, 'workspace.created'))).toBeVisible();

    await page.goto(`/${locale}/app`);
    // The switcher is a menu (SP1.5 T8): open it and pick the organisation.
    const switcher = page.getByRole('button', { name: t(locale, 'nav.currentWorkspace') });
    await expect(switcher).toBeVisible();
    await switcher.click();
    const option = page.getByRole('menuitemradio', { name: 'École E2E' });
    await expect(option).toHaveCount(1);
    await option.click();
    await expect(page).toHaveURL(/\/app\/w\/[^/?#]+$/, { timeout: 15_000 });
    const wid = new URL(page.url()).pathname.split('/').pop();
    expect(wid).toBeTruthy();

    await expect(page).toHaveURL(appUrl(`/${locale}/app/w/${wid}`), { timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: t(locale, 'workspace.settingsTitle') }),
    ).toBeVisible();
    await expect(page.getByLabel(t(locale, 'workspace.name'), { exact: true })).toHaveValue(
      'École E2E',
    );
    await expect(page.getByLabel(t(locale, 'workspace.country'), { exact: true })).toHaveValue(
      'TN',
    );
  });

  test('AC-WS-05 UI: rename the organisation; the change persists after reload', async ({
    page,
    uiLocale: locale,
  }) => {
    const owner = await seedUser({ organization: true, totp: true });
    await uiLogin(page, locale, owner);

    await page.goto(`/${locale}/app/w/${owner.orgWorkspaceId}`);
    await page.getByLabel(t(locale, 'workspace.name'), { exact: true }).fill('École Renommée');
    await page.getByRole('button', { name: t(locale, 'workspace.save'), exact: true }).click();
    await expect(toast(page, locale, t(locale, 'workspace.saved'))).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(t(locale, 'workspace.name'), { exact: true })).toHaveValue(
      'École Renommée',
    );
  });

  test('AC-WS-04 UI: members page lists both members; owner promotes the teacher to ADMIN; audit log records it', async ({
    page,
    uiLocale: locale,
  }) => {
    const owner = await seedUser({ organization: true, totp: true });
    const member = await seedUser();
    addOrgMember(owner.orgWorkspaceId!, member.userId, 'TEACHER');
    await uiLogin(page, locale, owner);

    await page.goto(`/${locale}/app/w/${owner.orgWorkspaceId}/members`);
    await expect(page.getByRole('heading', { name: t(locale, 'members.title') })).toBeVisible();
    // Both members are listed (SP1: no public "add member" route — the seed inserted the row).
    await expect(page.getByRole('row').filter({ hasText: owner.email })).toBeVisible();
    const memberRow = page.getByRole('row').filter({ hasText: member.email });
    await expect(memberRow).toBeVisible();
    await expect(page.getByLabel(t(locale, 'members.search'))).toBeVisible();
    // SP1: students join by invitation (SP2), so the assignment panel shows the note.
    await expect(page.getByTestId('assignments-list')).toBeVisible();
    await expect(page.getByText(t(locale, 'members.noStudents'))).toBeVisible();

    // Promote the TEACHER to ADMIN from the row menu (persisted, then visible after reload).
    await memberRow
      .getByRole('button', { name: rowActions(locale, `${member.firstName} Ben Ali`) })
      .click();
    await page.getByRole('menuitemradio', { name: t(locale, 'members.role_ADMIN') }).click();
    await expect(toast(page, locale, t(locale, 'members.roleChanged'))).toBeVisible();
    await page.reload();
    await expect(
      page
        .getByRole('row')
        .filter({ hasText: member.email })
        .getByText(t(locale, 'members.role_ADMIN'), { exact: true }),
    ).toBeVisible();

    // The audit log records workspace.created and the role change with before/after, under a
    // "Date" column, with two-way pagination (a single page here: both buttons disabled).
    await page.goto(`/${locale}/app/w/${owner.orgWorkspaceId}/audit-log`);
    await expect(page.getByTestId('audit-workspace.created')).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: t(locale, 'workspace.auditDate'), exact: true }),
    ).toBeAttached();
    const pagination = page.getByRole('navigation', {
      name: t(locale, 'workspace.auditPagination'),
    });
    await expect(
      pagination.getByRole('button', { name: t(locale, 'workspace.auditPrevious') }),
    ).toBeDisabled();
    await expect(
      pagination.getByRole('button', { name: t(locale, 'workspace.auditNext') }),
    ).toBeDisabled();
    const roleRow = page.getByTestId('audit-member.role_changed').first();
    await expect(roleRow).toBeVisible();
    await expect(roleRow.getByText('TEACHER')).toBeVisible();
    await expect(roleRow.getByText('ADMIN')).toBeVisible();
  });

  test('AC-WS-07 UI: report a member for abuse — dialog, success toast, RTL dialog in ar', async ({
    page,
    uiLocale: locale,
  }) => {
    const owner = await seedUser({ organization: true, totp: true });
    // SP1: no public "add member" route (SP2 invitations) — the seed inserts the row directly.
    const member = await seedUser();
    addOrgMember(owner.orgWorkspaceId!, member.userId);
    await uiLogin(page, locale, owner);

    await page.goto(`/${locale}/app/w/${owner.orgWorkspaceId}/members`);
    await page
      .getByRole('row')
      .filter({ hasText: member.email })
      .getByRole('button', { name: rowActions(locale, `${member.firstName} Ben Ali`) })
      .click();
    await page.getByRole('menuitem', { name: t(locale, 'abuse.report') }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: t(locale, 'abuse.title') })).toBeVisible();
    // The dialog inherits the page direction (RTL in the ar project).
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await dialog
      .getByLabel(t(locale, 'abuse.description'), { exact: true })
      .fill('Compte test e2e: message inapproprié simulé.');
    await dialog.getByRole('button', { name: t(locale, 'abuse.submit') }).click();
    // The success state appears once the POST lands; the dev API can take >5 s under the
    // full suite's load.
    await expect(dialog.getByRole('status')).toHaveText(t(locale, 'abuse.sent'), {
      timeout: 20_000,
    });
    // The success state closes from its footer button (the icon close button comes last).
    await dialog
      .getByRole('button', { name: t(locale, 'common.close') })
      .first()
      .click();
    await expect(dialog).toBeHidden();
  });

  test('a TEACHER sees no role actions on the members page', async ({ page, uiLocale: locale }) => {
    const owner = await seedUser({ organization: true, totp: true });
    const teacher = await seedUser();
    const student = await seedUser();
    addOrgMember(owner.orgWorkspaceId!, teacher.userId, 'TEACHER');
    // SP1: students join by invitation in SP2 — the seed inserts the membership directly.
    addOrgMember(owner.orgWorkspaceId!, student.userId, 'STUDENT');
    // The owner assigns the student to the teacher through the API (`student.assign`).
    const ctx = await playwrightRequest.newContext({ baseURL: appUrl('') });
    try {
      await apiLogin(ctx, owner);
      const res = await ctx.post(`/api/v1/workspaces/${owner.orgWorkspaceId}/assignments`, {
        data: { teacherUserId: teacher.userId, studentUserId: student.userId },
      });
      if (res.status() !== 201) throw new Error(`assign ${res.status()}: ${await res.text()}`);
    } finally {
      await ctx.dispose();
    }
    await uiLogin(page, locale, teacher);

    await page.goto(`/${locale}/app/w/${owner.orgWorkspaceId}/members`);
    await expect(page.getByRole('heading', { name: t(locale, 'members.title') })).toBeVisible();
    // Scope `own`: the teacher lists his assigned student; his row menu only reports.
    // Teachers do not see member emails: his single row is the assigned student's.
    const rows = page.getByRole('row').filter({
      has: page.getByRole('button', { name: rowActions(locale, `${student.firstName} Ben Ali`) }),
    });
    await expect(rows).toHaveCount(1);
    await rows.getByRole('button').click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: t(locale, 'abuse.report') })).toBeVisible();
    await expect(menu.getByRole('menuitemradio')).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: t(locale, 'members.remove') })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // The settings tab is read-only for him (no save button).
    await page.goto(`/${locale}/app/w/${owner.orgWorkspaceId}`);
    // Scoped to <main>: while the production build streams the page, React's not-yet-swapped
    // Suspense chunk (a hidden div outside <main>) briefly holds the same text, and an unscoped
    // getByText fails on the strict-mode violation instead of retrying.
    await expect(page.locator('#main').getByText(t(locale, 'workspace.readOnly'))).toBeVisible();
    await expect(
      page.getByRole('button', { name: t(locale, 'workspace.save'), exact: true }),
    ).toHaveCount(0);
  });

  test('AC-WS-09 UI: suspended workspace shows the banner', async ({ page, uiLocale: locale }) => {
    const owner = await seedUser({ organization: true, totp: true });
    await suspendWorkspaceAsSuperAdmin(owner.orgWorkspaceId!);
    await uiLogin(page, locale, owner);

    await page.goto(`/${locale}/app/w/${owner.orgWorkspaceId}`);
    await expect(
      page.getByRole('status').filter({ hasText: t(locale, 'workspace.suspended') }),
    ).toHaveText(t(locale, 'workspace.suspended'));
    await expect(page.getByLabel(t(locale, 'workspace.name'), { exact: true })).toBeVisible();
  });
});
