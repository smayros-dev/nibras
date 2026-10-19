import { request as playwrightRequest, type Page } from '@playwright/test';
import { appUrl, expect, t, test, toast, uiLogin, uniqueEmail } from './helpers';
import { fill, RAW_KEY, seedTeacher, yearsAgo, type Teacher } from './helpers/invitations';

/**
 * Plan SP2 Task 13: the students page (AC-INV-01/04/05/08 UI). A verified teacher (D-O6) signs in
 * and manages his personal workspace's students: email invitations from the dialog (resend
 * cooldown, revoke), a group link with approval that a student uses through the API, the
 * approval from the « En attente » tab, and the onboarding link.
 */

const BASE = 'http://localhost:3000';
const PASSWORD = 'un mot de passe assez long';

async function openStudents(page: Page, locale: string, teacher: Teacher) {
  await uiLogin(page, locale, teacher.user);
  await page.goto(`/${locale}/app/w/${teacher.wid}/students`);
}

function studentsHeading(page: Page, locale: string, count: number) {
  return page.getByRole('heading', {
    level: 2,
    name: fill(t(locale, 'students.title'), { count: String(count) }),
  });
}

/** The table row holding `text` (an invited address or a student's name). */
function row(page: Page, text: string) {
  return page.getByRole('row').filter({ hasText: text });
}

test.describe('students page (SP2 plan Task 13)', () => {
  test('AC-INV-01 UI: invite from the dialog → row "invitation en attente" in the pending tab; resend → toast; revoke → row gone', async ({
    page,
    uiLocale: locale,
  }) => {
    const teacher = await seedTeacher();
    try {
      await openStudents(page, locale, teacher);
      await expect(studentsHeading(page, locale, 0)).toBeVisible();
      await expect(
        page.getByRole('heading', { name: t(locale, 'students.emptyTitle') }),
      ).toBeVisible();

      // The header's « + Inviter » (the empty state repeats it).
      await page
        .getByRole('button', { name: t(locale, 'students.invite') })
        .first()
        .click();
      const dialog = page.getByRole('dialog', { name: t(locale, 'invitations.inviteTitle') });
      const email = uniqueEmail();
      await dialog.getByRole('textbox', { name: t(locale, 'invitations.email') }).fill(email);
      await dialog.getByRole('button', { name: t(locale, 'invitations.submit') }).click();
      await expect(toast(page, locale, fill(t(locale, 'invitations.sent'), { email }))).toBeVisible(
        { timeout: 15_000 },
      );
      await expect(dialog).toBeHidden();
      await expect(studentsHeading(page, locale, 1)).toBeVisible();

      await page.getByRole('tab', { name: t(locale, 'students.tabPending') }).click();
      await expect(page).toHaveURL(/\?tab=pending$/);
      const invited = row(page, email);
      await expect(invited.getByText(t(locale, 'invitations.status_PENDING'))).toBeVisible();
      expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);

      // AC-INV-04: a resend within 10 minutes of the last send is refused with the delay.
      const menu = page.getByRole('button', {
        name: fill(t(locale, 'invitations.rowActions'), { email }),
      });
      await menu.click();
      await page.getByRole('menuitem', { name: t(locale, 'invitations.resend') }).click();
      await expect(
        toast(page, locale, fill(t(locale, 'invitations.retryIn'), { min: '10' })),
      ).toBeVisible();

      // AC-INV-05: revoke behind a confirmation; the row leaves the pending list.
      await menu.click();
      await page.getByRole('menuitem', { name: t(locale, 'invitations.revoke') }).click();
      const confirm = page.getByRole('alertdialog', {
        name: fill(t(locale, 'invitations.revokeTitle'), { email }),
      });
      await confirm.getByRole('button', { name: t(locale, 'invitations.revokeConfirm') }).click();
      await expect(toast(page, locale, t(locale, 'invitations.revoked'))).toBeVisible();
      await expect(invited).toHaveCount(0);

      // The state survives a reload (`?tab=pending`): still nothing pending.
      await page.reload();
      await expect(
        page.getByRole('heading', { name: t(locale, 'students.emptyTitle') }),
      ).toBeVisible();
    } finally {
      await teacher.ctx.dispose();
    }
  });

  test('AC-INV-08 UI: create a group link with approval, a student joins (API), the pending tab shows him, Approuver → he moves to Tous', async ({
    page,
    uiLocale: locale,
  }) => {
    const teacher = await seedTeacher();
    const student = await playwrightRequest.newContext({ baseURL: BASE });
    try {
      await openStudents(page, locale, teacher);
      const toggle = page.getByRole('button', { name: t(locale, 'students.groupLink') });
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const card = page.getByTestId('invite-link-card');
      await expect(
        card.getByRole('heading', { name: t(locale, 'inviteLinks.title') }),
      ).toBeVisible();
      await card.getByLabel(t(locale, 'inviteLinks.label'), { exact: true }).fill('Groupe e2e');
      // A personal workspace defaults to no approval.
      const approval = card.getByRole('checkbox', {
        name: t(locale, 'inviteLinks.requiresApproval'),
      });
      await expect(approval).not.toBeChecked();
      await approval.check();
      await card.getByRole('button', { name: t(locale, 'inviteLinks.create') }).click();
      await expect(toast(page, locale, t(locale, 'inviteLinks.created'))).toBeVisible();
      const item = card.getByRole('listitem').filter({ hasText: 'Groupe e2e' }).first();
      await expect(
        item.getByText(t(locale, 'inviteLinks.approval'), { exact: true }),
      ).toBeVisible();
      await expect(
        item.getByText(fill(t(locale, 'inviteLinks.uses'), { used: '0', max: '50' })),
      ).toBeVisible();

      const links = (await (
        await teacher.ctx.get(`/api/v1/workspaces/${teacher.wid}/invite-links`)
      ).json()) as { code: string; label: string | null }[];
      const code = links.find((l) => l.label === 'Groupe e2e')?.code;
      if (!code) throw new Error('the created link is not listed');
      await expect(item.getByText(code, { exact: true })).toBeVisible();

      const joined = await student.post(`/api/v1/join/${code}/accept`, {
        data: {
          mode: 'REGISTER',
          email: uniqueEmail(),
          firstName: 'Omar',
          lastName: 'Haddad',
          password: PASSWORD,
          locale,
          timezone: 'Africa/Tunis',
          birthDate: yearsAgo(20),
          acceptTerms: true,
          acceptPrivacy: true,
        },
      });
      expect(joined.status()).toBe(201);
      expect(((await joined.json()) as { membershipStatus: string }).membershipStatus).toBe(
        'PENDING_APPROVAL',
      );

      await page.goto(`/${locale}/app/w/${teacher.wid}/students?tab=pending`);
      const omar = row(page, 'Omar Haddad');
      await expect(omar.getByText(t(locale, 'members.status_PENDING_APPROVAL'))).toBeVisible();
      await page
        .getByRole('button', {
          name: fill(t(locale, 'students.rowActions'), { name: 'Omar Haddad' }),
        })
        .click();
      await page.getByRole('menuitem', { name: t(locale, 'students.approve') }).click();
      await expect(
        toast(page, locale, fill(t(locale, 'students.approved'), { name: 'Omar Haddad' })),
      ).toBeVisible();
      await expect(omar).toHaveCount(0);

      await page.getByRole('tab', { name: t(locale, 'students.tabAll') }).click();
      await expect(omar.getByText(t(locale, 'members.status_ACTIVE'))).toBeVisible();
      expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    } finally {
      await student.dispose();
      await teacher.ctx.dispose();
    }
  });

  test('onboarding: "Inviter mes étudiants" links to the personal workspace students page', async ({
    page,
    uiLocale: locale,
  }) => {
    const teacher = await seedTeacher();
    try {
      await uiLogin(page, locale, teacher.user);
      const link = page
        .getByTestId('onboarding-checklist')
        .getByRole('link', { name: t(locale, 'onboarding.inviteStudents') });
      await expect(link).toHaveAttribute('href', `/${locale}/app/w/${teacher.wid}/students`);
      await link.click();
      await expect(page).toHaveURL(appUrl(`/${locale}/app/w/${teacher.wid}/students`));
      await expect(studentsHeading(page, locale, 0)).toBeVisible();
      // The workspace tab and the sidebar item mark the page.
      await expect(
        page.getByRole('link', { name: t(locale, 'workspace.navStudents') }).first(),
      ).toHaveAttribute('aria-current', 'page');
    } finally {
      await teacher.ctx.dispose();
    }
  });
});
