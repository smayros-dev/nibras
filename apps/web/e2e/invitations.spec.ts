import { messages } from '@nibras/i18n';
import { request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';
import { apiLogin, appUrl, expect, t, test, uiLogin, uniqueEmail } from './helpers';
import { extractLink, waitForEmail } from './helpers/mailpit';
import { seedUser, type SeededUser } from './helpers/seed';

/**
 * Plan SP2 Task 11: the public invitation and join pages (AC-INV-01/02/03 UI, Review Focus 6).
 * The teacher side is seeded through the API (a verified teacher, D-O6, inviting into his
 * personal workspace); the student side is driven in the browser. Emails come from Mailpit,
 * searched by the unique recipient address.
 */

const BASE = 'http://localhost:3000';
const PASSWORD = 'un mot de passe assez long';

/** A raw `namespace.key` message id rendered instead of its translation (Review Focus 6). */
const RAW_KEY = new RegExp(`\\b(${Object.keys(messages.fr).join('|')})\\.[A-Za-z_]+\\b`);

/** `{name}` placeholders of a catalogue message filled in. */
function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

/** `ahmed@example.com` → `a***@example.com` (`maskEmail`, `@nibras/contracts`). */
function masked(email: string): string {
  const at = email.lastIndexOf('@');
  return `${email[0]}***${email.slice(at)}`;
}

/** A birth date `years` years ago (the birthday already passed), `YYYY-MM-DD`. */
function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

interface Teacher {
  user: SeededUser;
  ctx: APIRequestContext;
  wid: string;
  workspaceName: string;
}

/** A verified teacher signed in on its own request context, with its personal workspace. */
async function seedTeacher(): Promise<Teacher> {
  const user = await seedUser({ verifiedTeacher: true });
  const ctx = await playwrightRequest.newContext({ baseURL: BASE });
  await apiLogin(ctx, user);
  const res = await ctx.get('/api/v1/me/workspaces');
  expect(res.status()).toBe(200);
  const list = (await res.json()) as {
    workspace: { id: string; name: string; type: string };
  }[];
  const personal = list.find((m) => m.workspace.type === 'PERSONAL');
  if (!personal) throw new Error('the seeded teacher has no personal workspace');
  return { user, ctx, wid: personal.workspace.id, workspaceName: personal.workspace.name };
}

/** Invites `email` as a STUDENT and returns the raw token of the emailed link. */
async function inviteStudent(teacher: Teacher, email: string): Promise<string> {
  const res = await teacher.ctx.post(`/api/v1/workspaces/${teacher.wid}/invitations`, {
    data: { email, role: 'STUDENT' },
  });
  if (res.status() !== 201) throw new Error(`invite ${res.status()}: ${await res.text()}`);
  const mail = await waitForEmail(email, '/invite/');
  const link = extractLink(mail.html, '/invite/');
  const token = link ? new URL(link).pathname.split('/').pop() : undefined;
  if (!token) throw new Error('no invitation link in the email');
  return token;
}

/** Accepts the pending-consent gate every e2e account meets (the e2e API bumps TERMS). */
async function acceptConsentGate(page: Page, locale: string) {
  const gate = page.getByRole('dialog', { name: t(locale, 'auth.consent.title') });
  await expect(gate).toBeVisible({ timeout: 15_000 });
  await gate.getByRole('button', { name: t(locale, 'auth.consent.accept') }).click();
  await expect(gate).toBeHidden();
}

/** Fills the register fields shared by the invitation and join pages, then submits. */
async function register(
  page: Page,
  locale: string,
  { email, birthDate }: { email?: string; birthDate: string },
) {
  await page.getByLabel(t(locale, 'auth.register.firstName'), { exact: true }).fill('Amina');
  await page.getByLabel(t(locale, 'auth.register.lastName'), { exact: true }).fill('Trabelsi');
  if (email) await page.getByLabel(t(locale, 'auth.register.email'), { exact: true }).fill(email);
  await page.getByLabel(t(locale, 'auth.register.password'), { exact: true }).fill(PASSWORD);
  await page.getByLabel(t(locale, 'invite.birthDate'), { exact: true }).fill(birthDate);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: t(locale, 'invite.registerSubmit') }).click();
}

/** The dashboard row of a workspace (`li` holding its link). */
function workspaceRow(page: Page, name: string) {
  return page.getByRole('listitem').filter({ has: page.getByRole('link', { name, exact: true }) });
}

test.describe('invitations (SP2 plan Task 11)', () => {
  test('AC-INV-01/03 UI: teacher invites via API, the emailed link opens the invite page, an anonymous adult registers and lands on /app with the workspace listed ACTIVE', async ({
    page,
    uiLocale: locale,
  }) => {
    const teacher = await seedTeacher();
    try {
      const studentEmail = uniqueEmail();
      const token = await inviteStudent(teacher, studentEmail);

      await page.goto(`/${locale}/invite/${token}`);
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: fill(t(locale, 'invite.title'), {
            inviter: `${teacher.user.firstName} Ben Ali`,
            workspace: teacher.workspaceName,
          }),
        }),
      ).toBeVisible();
      // The address is the invited one, shown masked, never typed.
      await expect(
        page.getByText(fill(t(locale, 'invite.registerLead'), { email: masked(studentEmail) })),
      ).toBeVisible();
      await register(page, locale, { birthDate: yearsAgo(25) });

      await expect(page).toHaveURL(appUrl(`/${locale}/app`), { timeout: 15_000 });
      await acceptConsentGate(page, locale);
      const row = workspaceRow(page, teacher.workspaceName);
      await expect(row).toBeVisible();
      await expect(row.getByText(t(locale, 'members.role_STUDENT'), { exact: true })).toBeVisible();
      // ACTIVE: no membership-status badge on the row.
      for (const status of ['PENDING_APPROVAL', 'PENDING_GUARDIAN_CONSENT']) {
        await expect(row.getByText(t(locale, `members.status_${status}`))).toHaveCount(0);
      }

      // The link is single-use: it now says so.
      await page.goto(`/${locale}/invite/${token}`);
      await expect(
        page.getByRole('heading', { level: 1, name: t(locale, 'invite.accepted') }),
      ).toBeVisible();
      expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);
    } finally {
      await teacher.ctx.dispose();
    }
  });

  test('AC-INV-02 UI: logged in as another user, the invite page says the invitation is for a***@… and offers to sign out; after sign-out the register form appears', async ({
    page,
    uiLocale: locale,
  }) => {
    const teacher = await seedTeacher();
    try {
      const studentEmail = uniqueEmail();
      const token = await inviteStudent(teacher, studentEmail);
      const other = await seedUser();
      await uiLogin(page, locale, other);

      await page.goto(`/${locale}/invite/${token}`);
      const email = masked(studentEmail);
      await expect(page.getByText(fill(t(locale, 'invite.mismatch'), { email }))).toBeVisible();
      await expect(
        page.getByLabel(t(locale, 'auth.register.password'), { exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole('button', { name: fill(t(locale, 'invite.switchAccount'), { email }) })
        .click();

      // Same page, now anonymous: the register form for the invited address.
      await expect(page.getByText(fill(t(locale, 'invite.registerLead'), { email }))).toBeVisible({
        timeout: 15_000,
      });
      await expect(page).toHaveURL(appUrl(`/${locale}/invite/${token}`));
      await expect(
        page.getByLabel(t(locale, 'auth.register.password'), { exact: true }),
      ).toBeVisible();
      // The session is gone: the app sends to login.
      const me = await page.request.get('/api/v1/me');
      expect(me.status()).toBe(401);
    } finally {
      await teacher.ctx.dispose();
    }
  });

  test('join code with approval: register, see the "demande envoyée" page; the teacher approves via API; the student sees the workspace', async ({
    page,
    uiLocale: locale,
  }) => {
    const teacher = await seedTeacher();
    try {
      const created = await teacher.ctx.post(`/api/v1/workspaces/${teacher.wid}/invite-links`, {
        data: { requiresApproval: true },
      });
      expect(created.status()).toBe(201);
      const { code } = (await created.json()) as { code: string };
      const teacherName = `${teacher.user.firstName} Ben Ali`;

      await page.goto(`/${locale}/join/${code}`);
      await expect(
        page.getByText(fill(t(locale, 'join.approvalNotice'), { teacher: teacherName })),
      ).toBeVisible();
      const studentEmail = uniqueEmail();
      await register(page, locale, { email: studentEmail, birthDate: yearsAgo(20) });
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: fill(t(locale, 'join.requested'), { teacher: teacherName }),
        }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('link', { name: t(locale, 'join.verifyEmail') })).toBeVisible();

      // A code proves nothing about the mailbox (D2): verify it, as the emailed link would.
      const mail = await waitForEmail(studentEmail, 'verify-email');
      const verifyLink = extractLink(mail.html, '/verify-email?token=');
      const verifyToken = verifyLink ? new URL(verifyLink).searchParams.get('token') : null;
      expect(verifyToken).toBeTruthy();
      const verified = await page.request.post('/api/v1/auth/verify-email', {
        data: { token: verifyToken },
      });
      expect(verified.status()).toBe(200);

      await page.goto(`/${locale}/app`);
      await acceptConsentGate(page, locale);
      const row = workspaceRow(page, teacher.workspaceName);
      await expect(row.getByText(t(locale, 'members.status_PENDING_APPROVAL'))).toBeVisible();

      // Inside the workspace: the waiting panel, not the pages.
      await page.goto(`/${locale}/app/w/${teacher.wid}`);
      await expect(
        page.getByRole('heading', { name: t(locale, 'pending.approval') }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: t(locale, 'pending.resend') })).toHaveCount(0);
      expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);

      const me = (await (await page.request.get('/api/v1/me')).json()) as { id: string };
      const approved = await teacher.ctx.post(
        `/api/v1/workspaces/${teacher.wid}/members/${me.id}/approve`,
      );
      expect(approved.status()).toBe(200);

      await page.goto(`/${locale}/app`);
      await expect(row).toBeVisible();
      await expect(row.getByText(t(locale, 'members.status_PENDING_APPROVAL'))).toHaveCount(0);
      await page.goto(`/${locale}/app/w/${teacher.wid}`);
      await expect(page.getByRole('heading', { name: t(locale, 'pending.approval') })).toHaveCount(
        0,
      );
    } finally {
      await teacher.ctx.dispose();
    }
  });

  test('AR: the invite page is dir=rtl, no raw keys', async ({ page, uiLocale: locale }) => {
    test.skip(locale !== 'ar', 'Arabic page check (Review Focus 6)');
    const teacher = await seedTeacher();
    try {
      const token = await inviteStudent(teacher, uniqueEmail());
      await page.goto(`/ar/invite/${token}`);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
      await expect(
        page.getByRole('button', { name: t('ar', 'invite.registerSubmit') }),
      ).toBeVisible();
      expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);

      // An unknown code on the join page: translated, still rtl.
      await page.goto('/ar/join/ZZZZZZZZ');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(
        page.getByRole('heading', { level: 1, name: t('ar', 'join.invalid') }),
      ).toBeVisible();
      expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY);
    } finally {
      await teacher.ctx.dispose();
    }
  });
});
