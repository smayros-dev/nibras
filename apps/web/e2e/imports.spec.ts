import { readFile } from 'node:fs/promises';
import { expect, t, test, uiLogin } from './helpers';
import { fill, RAW_KEY, seedTeacher } from './helpers/invitations';

/**
 * Plan SP2 Task 15: the CSV import dialog (AC-INV-07 UI). A verified teacher imports a 100-line
 * file generated here (no fixture file): 95 distinct valid addresses, 3 invalid emails and 2
 * repeats of valid addresses. The preview flags the 5 lines, the worker sends the 95 invitations,
 * the pending tab lists them and the downloaded report has one line per CSV line.
 */

function generateCsv(): { content: string; valid: string[] } {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const valid = Array.from({ length: 95 }, (_, i) => `imp-${stamp}-${i}@example.com`);
  const lines = valid.map((email, i) => `${email},Élève${i},Test`);
  // Lines 20, 50 and 80 of the data: invalid addresses; two repeats (case-insensitive).
  lines.splice(19, 0, 'not-an-email,X,Y');
  lines.splice(49, 0, `imp-${stamp}@`, 'pas une adresse,X,Y');
  lines.push(valid[3]!.toUpperCase() + ',Again,Test', `${valid[7]},Again,Test`);
  return { content: ['email,first_name,last_name', ...lines].join('\n') + '\n', valid };
}

test.describe('csv import (SP2 plan Task 15)', () => {
  test('AC-INV-07 UI: a generated 100-row CSV with 3 invalid emails and 2 duplicates → preview flags 5, import runs (worker), 95 invitations in the pending tab, report downloads with 100 lines', async ({
    page,
    uiLocale: locale,
  }) => {
    test.setTimeout(180_000);
    const teacher = await seedTeacher();
    try {
      const { content } = generateCsv();
      expect(content.trim().split('\n')).toHaveLength(101);
      await uiLogin(page, locale, teacher.user);
      await page.goto(`/${locale}/app/w/${teacher.wid}/students`);

      await page.getByRole('button', { name: t(locale, 'students.importCsv') }).click();
      const dialog = page.getByRole('dialog', { name: t(locale, 'imports.title') });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(t(locale, 'imports.file')).setInputFiles({
        name: 'classe.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(content, 'utf8'),
      });
      await dialog.getByRole('button', { name: t(locale, 'imports.preview') }).click();
      await expect(
        dialog.getByText(fill(t(locale, 'imports.summary'), { valid: '95', invalid: '5' })),
      ).toBeVisible({ timeout: 15_000 });

      const table = dialog.getByRole('table', { name: t(locale, 'imports.previewCaption') });
      await dialog.getByRole('checkbox', { name: t(locale, 'imports.errorsOnly') }).check();
      // Header + the 5 flagged lines.
      await expect(table.getByRole('row')).toHaveCount(6);
      await expect(table.getByText(t(locale, 'imports.outcome_INVALID_EMAIL'))).toHaveCount(3);
      await expect(table.getByText(t(locale, 'imports.outcome_DUPLICATE_IN_FILE'))).toHaveCount(2);
      await expect(dialog).not.toContainText(RAW_KEY);

      await dialog
        .getByRole('button', { name: fill(t(locale, 'imports.confirm'), { valid: '95' }) })
        .click();
      await expect(
        dialog.getByText(fill(t(locale, 'imports.completed'), { created: '95', failed: '0' })),
      ).toBeVisible({ timeout: 120_000 });
      await expect(
        dialog.getByRole('progressbar', { name: t(locale, 'imports.progressLabel') }),
      ).toHaveAttribute('aria-valuenow', '95');

      const download = page.waitForEvent('download');
      await dialog.getByRole('link', { name: t(locale, 'imports.report') }).click();
      const report = await readFile((await (await download).path())!, 'utf8');
      expect(report.charCodeAt(0)).toBe(0xfeff);
      const reportLines = report
        .replace(/^\uFEFF/, '')
        .trim()
        .split(/\r?\n/);
      expect(reportLines[0]).toBe('line,email,outcome,message');
      expect(reportLines.slice(1)).toHaveLength(100);
      expect(reportLines.filter((l) => l.includes(',CREATED'))).toHaveLength(95);

      await dialog
        .getByRole('button', { name: t(locale, 'common.close') })
        .first()
        .click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole('heading', {
          level: 2,
          name: fill(t(locale, 'students.title'), { count: '95' }),
        }),
      ).toBeVisible();
      await page.getByRole('tab', { name: t(locale, 'students.tabPending') }).click();
      const invitations = page.getByRole('table', { name: t(locale, 'invitations.title') });
      // Header + the 95 open invitations.
      await expect(invitations.getByRole('row')).toHaveCount(96);
    } finally {
      await teacher.ctx.dispose();
    }
  });
});
