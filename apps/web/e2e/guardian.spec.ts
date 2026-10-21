import type { Browser, Page } from '@playwright/test';
import { appUrl, expect, t, test, uniqueEmail } from './helpers';
import {
  acceptConsentGate,
  fill,
  grantByApi,
  inviteStudent,
  masked,
  RAW_KEY,
  registerMinorByApi,
  seedTeacher,
  tokenFromEmail,
  yearsAgo,
  type Teacher,
} from './helpers/invitations';
import { waitForEmail } from './helpers/mailpit';

/**
 * Plan SP2 Task 12: the guardian consent page and the guardian page (AC-INV-09/10/11 UI, Review
 * Focus 6). A verified teacher (API) invites a 15-year-old student who registers with a guardian
 * address; the guardian — anonymous, in a browser context of his own — answers from the emailed
 * links. Emails come from Mailpit, searched by the unique recipient address.
 */

const BASE = 'http://localhost:3000';
const PASSWORD = 'un mot de passe assez long';
const STUDENT = 'Amina Trabelsi';

/** The anonymous guardian's own browser context (no student or teacher cookie). */
async function guardianPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE });
  return context.newPage();
}

/** Fills the guardian identity fields and checks « J'autorise … ». */
async function fillGuardian(page: Page, locale: string, teacher: Teacher) {
  await page.getByLabel(t(locale, 'guardian.firstName'), { exact: true }).fill('Karim');
  await page.getByLabel(t(locale, 'guardian.lastName'), { exact: true }).fill('Trabelsi');
  await page.getByLabel(t(locale, 'guardian.relationship'), { exact: true }).selectOption('PARENT');
  await page
    .getByRole('checkbox', {
      name: fill(t(locale, 'guardian.authorize'), {
        student: STUDENT,
        teacher: `${teacher.user.firstName} Ben Ali`,
      }),
    })
    .check();
}

function waitingHeading(page: Page, locale: string, guardianEmail: string) {
  return page.getByRole('heading', {
    name: fill(t(locale, 'pending.guardianWaiting'), { email: masked(guardianEmail) }),
  });
}

test.describe('guardian (SP2 plan Task 12)', () => {
  test("AC-INV-09/10 UI: a minor registers from an invite link (birth date 15 y), the guardian email arrives (Mailpit), the consent page grants with name + relationship, the student's workspace becomes usable (waiting panel gone), the guardian confirmation email links to the guardian page listing no sessions yet", async ({
    page,
    browser,
    uiLocale: locale,
  }) => {
    const teacher = await seedTeacher();
    const guardian = await guardianPage(browser);
    try {
      const teacherName = `${teacher.user.firstName} Ben Ali`;
      const studentEmail = uniqueEmail();
      const guardianEmail = uniqueEmail();
      const token = await inviteStudent(teacher, studentEmail);

      // The student registers in the browser; a minor's birth date reveals the guardian field.
      await page.goto(`/${locale}/invite/${token}`);
      await page.getByLabel(t(locale, 'auth.register.firstName'), { exact: true }).fill('Amina');
      await page.getByLabel(t(locale, 'auth.register.lastName'), { exact: true }).fill('Trabelsi');
      await page.getByLabel(t(locale, 'auth.register.password'), { exact: true }).fill(PASSWORD);
      await page.getByLabel(t(locale, 'invite.birthDate'), { exact: true }).fill(yearsAgo(15));
      await page.getByLabel(t(locale, 'invite.guardianEmail'), { exact: true }).fill(guardianEmail);
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: t(locale, 'invite.registerSubmit') }).click();
      await expect(page).toHaveURL(appUrl(`/${locale}/app/w/${teacher.wid}`), {
        timeout: 15_000,
      });
      // The e2e API bumps TERMS: the workspace route answers 403 CONSENT_REQUIRED, which leaves
      // the ConsentGate on this very page (not a 404); once accepted, the layout re-runs and
      // shows the waiting panel (production registers on the current versions, no gate).
      await expect(page.getByRole('dialog', { name: t(locale, 'auth.consent.title') })).toBeVisible(
        { timeout: 15_000 },
      );
      await expect(page.getByText(t(locale, 'errorPages.notFoundTitle'))).toHaveCount(0);
      await acceptConsentGate(page, locale);
      await expect(waitingHeading(page, locale, guardianEmail)).toBeVisible({ timeout: 15_000 });

      // The guardian's request email, then the consent page (anonymous, own context).
      const request = await waitForEmail(guardianEmail, '/guardian-consent/');
      const consentToken = tokenFromEmail(request.html, '/guardian-consent/');
      await guardian.goto(`/${locale}/guardian-consent/${consentToken}`);
      await expect(
        guardian.getByRole('heading', {
          level: 1,
          name: fill(t(locale, 'guardian.consentTitle'), {
            student: STUDENT,
            teacher: teacherName,
            workspace: teacher.workspaceName,
          }),
        }),
      ).toBeVisible();
      const grant = guardian.getByRole('button', { name: t(locale, 'guardian.grant') });
      await expect(grant).toBeDisabled();
      await fillGuardian(guardian, locale, teacher);
      await grant.click();
      await expect(
        guardian.getByRole('heading', {
          level: 1,
          name: fill(t(locale, 'guardian.granted'), { student: STUDENT, teacher: teacherName }),
        }),
      ).toBeVisible({ timeout: 15_000 });
      expect(await guardian.locator('body').innerText()).not.toMatch(RAW_KEY);

      // The consent link is single-use.
      const again = await guardian.request.get(`/api/v1/guardian-consent/${consentToken}`);
      expect(again.status()).toBe(410);

      // The student's workspace is usable: the waiting panel is gone.
      await page.reload();
      await expect(page.getByRole('main')).toBeVisible();
      await expect(waitingHeading(page, locale, guardianEmail)).toHaveCount(0);

      // The confirmation email links to the guardian page (same token as the thank-you link).
      const confirmation = await waitForEmail(guardianEmail, '/guardian/');
      const pageToken = tokenFromEmail(confirmation.html, '/guardian/');
      await expect(
        guardian.getByRole('link', {
          name: fill(t(locale, 'guardian.viewSessions'), { student: STUDENT }),
        }),
      ).toHaveAttribute('href', `/${locale}/guardian/${pageToken}`);
      await guardian.goto(`/${locale}/guardian/${pageToken}`);
      await expect(
        guardian.getByRole('heading', {
          level: 1,
          name: fill(t(locale, 'guardian.pageTitle'), { student: STUDENT }),
        }),
      ).toBeVisible();
      await expect(
        guardian.getByText(t(locale, 'guardian.status_ACTIVE'), { exact: true }),
      ).toBeVisible();
      await expect(
        guardian.getByRole('heading', { name: t(locale, 'guardian.noSessions') }),
      ).toBeVisible();
      expect(await guardian.locator('body').innerText()).not.toMatch(RAW_KEY);
    } finally {
      await guardian.context().close();
      await teacher.ctx.dispose();
    }
  });

  test('AC-INV-11 UI: from the guardian page, revoke → the student sees "Consentement retiré"; re-grant → active again', async ({
    page,
    browser,
    uiLocale: locale,
  }) => {
    const teacher = await seedTeacher();
    const guardian = await guardianPage(browser);
    try {
      const guardianEmail = uniqueEmail();
      const token = await inviteStudent(teacher, uniqueEmail());
      await registerMinorByApi(page.request, token, locale, guardianEmail);
      const request = await waitForEmail(guardianEmail, '/guardian-consent/');
      const pageToken = await grantByApi(
        guardian.request,
        tokenFromEmail(request.html, '/guardian-consent/'),
      );

      // Revoke, confirmed in the dialog that quotes D-O5.
      await guardian.goto(`/${locale}/guardian/${pageToken}`);
      await guardian.getByRole('button', { name: t(locale, 'guardian.revoke') }).click();
      const dialog = guardian.getByRole('alertdialog');
      await expect(dialog).toContainText(
        fill(t(locale, 'guardian.revokeDescription'), {
          student: STUDENT,
          teacher: `${teacher.user.firstName} Ben Ali`,
        }),
      );
      await dialog.getByRole('button', { name: t(locale, 'guardian.revokeConfirm') }).click();
      await expect(
        guardian.getByText(t(locale, 'guardian.status_REVOKED'), { exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      // The student sees why the workspace is closed.
      await page.goto(`/${locale}/app/w/${teacher.wid}`);
      await expect(page.getByRole('heading', { name: t(locale, 'pending.revoked') })).toBeVisible({
        timeout: 15_000,
      });

      // Re-grant: the identity form again, then a new page link.
      await guardian.getByRole('button', { name: t(locale, 'guardian.regrant') }).click();
      await fillGuardian(guardian, locale, teacher);
      await guardian.getByRole('button', { name: t(locale, 'guardian.regrantSubmit') }).click();
      await expect(guardian).not.toHaveURL(new RegExp(pageToken), { timeout: 15_000 });
      await expect(guardian).toHaveURL(new RegExp(`/${locale}/guardian/[A-Za-z0-9_-]+$`));
      await expect(
        guardian.getByText(t(locale, 'guardian.status_ACTIVE'), { exact: true }),
      ).toBeVisible();
      const old = await guardian.request.get(`/api/v1/guardian/${pageToken}`);
      expect(old.status()).toBe(410);

      await page.reload();
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('heading', { name: t(locale, 'pending.revoked') })).toHaveCount(
        0,
      );
    } finally {
      await guardian.context().close();
      await teacher.ctx.dispose();
    }
  });

  test('AR: consent page dir=rtl, Arabic email subject, no raw keys', async ({
    page,
    browser,
    uiLocale: locale,
  }) => {
    test.skip(locale !== 'ar', 'Arabic page check (Review Focus 6)');
    const teacher = await seedTeacher();
    const guardian = await guardianPage(browser);
    try {
      // The guardian has no account: he is written to in the workspace's default locale.
      const patched = await teacher.ctx.patch(`/api/v1/workspaces/${teacher.wid}`, {
        data: { defaultLocale: 'ar' },
      });
      expect(patched.status()).toBe(200);
      const guardianEmail = uniqueEmail();
      const token = await inviteStudent(teacher, uniqueEmail());
      await registerMinorByApi(page.request, token, 'ar', guardianEmail);

      const request = await waitForEmail(guardianEmail, '/guardian-consent/');
      expect(request.subject).toMatch(/[؀-ۿ]/);
      expect(request.html).toContain('dir="rtl"');
      const consentToken = tokenFromEmail(request.html, '/ar/guardian-consent/');

      await guardian.goto(`/ar/guardian-consent/${consentToken}`);
      await expect(guardian.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(guardian.locator('html')).toHaveAttribute('lang', 'ar');
      await expect(guardian.getByRole('button', { name: t('ar', 'guardian.grant') })).toBeVisible();
      expect(await guardian.locator('body').innerText()).not.toMatch(RAW_KEY);

      // The guardian page after the grant: still rtl and translated.
      await fillGuardian(guardian, 'ar', teacher);
      await guardian.getByRole('button', { name: t('ar', 'guardian.grant') }).click();
      await guardian
        .getByRole('link', { name: fill(t('ar', 'guardian.viewSessions'), { student: STUDENT }) })
        .click();
      await expect(
        guardian.getByRole('heading', { name: t('ar', 'guardian.noSessions') }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(guardian.locator('html')).toHaveAttribute('dir', 'rtl');
      expect(await guardian.locator('body').innerText()).not.toMatch(RAW_KEY);
    } finally {
      await guardian.context().close();
      await teacher.ctx.dispose();
    }
  });
});
