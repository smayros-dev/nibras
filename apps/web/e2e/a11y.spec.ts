import AxeBuilder from '@axe-core/playwright';
import {
  request as playwrightRequest,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { expect, t, test, uiLogin, uniqueEmail } from './helpers';
import {
  grantByApi,
  inviteStudent,
  registerMinorByApi,
  seedTeacher,
  tokenFromEmail,
} from './helpers/invitations';
import { waitForEmail } from './helpers/mailpit';
import { joinByInvitation, seedUser } from './helpers/seed';

/**
 * Spec §8 / audit #15: axe WCAG 2 A/AA on the main pages, in the project's locale (fr, ar) on
 * desktop and mobile. Serious and critical violations fail the test; each page is also captured
 * full-page under `test-results/screens/{project}/` for the RTL recette (CI artefact
 * `rtl-screens`).
 */

const BLOCKING = ['serious', 'critical'];

/** `modal`: a dialog is open, which hides `main` from the accessibility tree; wait for it instead. */
async function audit(page: Page, testInfo: TestInfo, name: string, modal?: Locator) {
  await expect(modal ?? page.getByRole('main').first()).toBeVisible();
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

  test('SP2 pages: invite, join, guardian consent, guardian (anonymous); students, csv import, student profile (teacher)', async ({
    page,
    uiLocale: locale,
  }, testInfo) => {
    test.setTimeout(120_000);
    // Seeded through the API: a verified teacher, an open invitation, a group code and a minor
    // whose guardian consent request is answered after its page is audited.
    const teacher = await seedTeacher();
    const minor = await playwrightRequest.newContext({ baseURL: 'http://localhost:3000' });
    const guardian = await playwrightRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const inviteToken = await inviteStudent(teacher, uniqueEmail());
      const link = await teacher.ctx.post(`/api/v1/workspaces/${teacher.wid}/invite-links`, {
        data: {},
      });
      expect(link.status()).toBe(201);
      const { code } = (await link.json()) as { code: string };
      const guardianEmail = uniqueEmail();
      await registerMinorByApi(
        minor,
        await inviteStudent(teacher, uniqueEmail()),
        locale,
        guardianEmail,
      );
      const consentMail = await waitForEmail(guardianEmail, '/guardian-consent/');
      const consentToken = tokenFromEmail(consentMail.html, '/guardian-consent/');

      // The public pages first, while `page` is still anonymous.
      const pub = page;
      await pub.goto(`/${locale}/invite/${inviteToken}`);
      await audit(pub, testInfo, 'invite');
      await pub.goto(`/${locale}/join/${code}`);
      await audit(pub, testInfo, 'join');
      await pub.goto(`/${locale}/guardian-consent/${consentToken}`);
      await audit(pub, testInfo, 'guardian-consent');
      const guardianToken = await grantByApi(guardian, consentToken);
      await pub.goto(`/${locale}/guardian/${guardianToken}`);
      await audit(pub, testInfo, 'guardian');

      await uiLogin(page, locale, teacher.user);
      await page.goto(`/${locale}/app/w/${teacher.wid}/students`);
      await expect(page.getByRole('table')).toBeVisible();
      await audit(page, testInfo, 'students');
      await page.getByRole('button', { name: t(locale, 'students.importCsv') }).click();
      const dialog = page.getByRole('dialog', { name: t(locale, 'imports.title') });
      await dialog.getByLabel(t(locale, 'imports.file')).setInputFiles({
        name: 'classe.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          `email
${uniqueEmail()}
not-an-email
`,
          'utf8',
        ),
      });
      await audit(page, testInfo, 'students-import', dialog);
      await dialog.getByRole('button', { name: t(locale, 'imports.preview') }).click();
      await expect(dialog.getByRole('table')).toBeVisible();
      await audit(page, testInfo, 'students-import-preview', dialog);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      const students = await teacher.ctx.get(`/api/v1/workspaces/${teacher.wid}/students`);
      const { items } = (await students.json()) as { items: { userId: string }[] };
      expect(items).toHaveLength(1);
      await page.goto(`/${locale}/app/w/${teacher.wid}/students/${items[0]!.userId}`);
      await expect(page.getByRole('heading', { level: 2, name: /Amina/ })).toBeVisible();
      await audit(page, testInfo, 'student-profile');
    } finally {
      await guardian.dispose();
      await minor.dispose();
      await teacher.ctx.dispose();
    }
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
