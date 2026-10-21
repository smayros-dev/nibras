import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImportPreview, ImportRow, InvitationImportStatus } from '@nibras/contracts';
import { IMPORT_MAX_BYTES } from '@nibras/contracts/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../test/render';
import { CsvImportDialog } from './csv-import-dialog';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const IMPORT_ID = 'bbbbbbbb-0000-4000-8000-000000000001';

const fill = (key: string, values: Record<string, string | number>, locale: 'fr' | 'ar' = 'fr') =>
  tr(locale, key).replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

function row(line: number, email: string, outcome: ImportRow['outcome']): ImportRow {
  return {
    line,
    email,
    firstName: null,
    lastName: null,
    guardianEmail: null,
    birthDate: null,
    courseCodes: [],
    outcome,
  };
}

const PREVIEW: ImportPreview = {
  totalRows: 4,
  validRows: 2,
  rows: [
    row(2, 'nour@example.com', 'OK'),
    row(3, 'not-an-email', 'INVALID_EMAIL'),
    row(4, 'sami@example.com', 'OK_COURSES_IGNORED'),
    row(5, 'nour@example.com', 'DUPLICATE_IN_FILE'),
  ],
};

function status(
  over: Partial<InvitationImportStatus> & Pick<InvitationImportStatus, 'status'>,
): InvitationImportStatus {
  return {
    id: IMPORT_ID,
    fileName: 'classe.csv',
    totalRows: 4,
    validRows: 2,
    processedRows: 0,
    createdCount: 0,
    failedCount: 0,
    report: [],
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-10-21T08:00:00.000Z',
    ...over,
  };
}

const CSV = 'email,first_name\nnour@example.com,Nour\n';
const csvFile = (content = CSV, name = 'classe.csv') =>
  new File([content], name, { type: 'text/csv' });

const onDone = vi.fn();
const onOpenChange = vi.fn();

function renderDialog(locale: 'fr' | 'ar' = 'fr') {
  renderWithIntl(
    <CsvImportDialog wid="w1" open onOpenChange={onOpenChange} onDone={onDone} pollMs={10} />,
    { locale },
  );
  return screen.getByRole('dialog', { name: tr(locale, 'imports.title') });
}

async function choose(dialog: HTMLElement, file: File, locale: 'fr' | 'ar' = 'fr') {
  const ue = userEvent.setup();
  await ue.upload(
    within(dialog).getByLabelText(tr(locale, 'imports.file'), { exact: false }),
    file,
  );
  return ue;
}

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  onDone.mockReset();
  onOpenChange.mockReset();
});

describe('CsvImportDialog', () => {
  it('lists the columns and offers the template', () => {
    const dialog = renderDialog();
    expect(within(dialog).getByText(tr('fr', 'imports.fileHint'))).toBeVisible();
    const template = within(dialog).getByRole('link', { name: tr('fr', 'imports.template') });
    expect(template).toHaveAttribute('download');
    expect(decodeURIComponent(template.getAttribute('href') ?? '')).toContain(
      'email,first_name,last_name,guardian_email,birth_date,course_codes',
    );
  });

  it('blocks an oversized file client-side without reading or posting it', async () => {
    const dialog = renderDialog();
    const big = csvFile('x'.repeat(IMPORT_MAX_BYTES + 1));
    const ue = await choose(dialog, big);
    expect(await within(dialog).findByText(tr('fr', 'imports.fileTooLarge'))).toBeVisible();
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'imports.preview') }));
    expect(api.POST).not.toHaveBeenCalled();
  });

  it('previews with dryRun=true and shows every line with its outcome; errors-only filter', async () => {
    api.POST.mockResolvedValue({ data: PREVIEW });
    const dialog = renderDialog();
    const ue = await choose(dialog, csvFile());
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'imports.preview') }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/invitations/import', {
        params: { path: { wid: 'w1' }, query: { dryRun: 'true' } },
        body: { fileName: 'classe.csv', content: CSV },
      }),
    );
    expect(
      await within(dialog).findByText(fill('imports.summary', { valid: 2, invalid: 2 })),
    ).toBeVisible();
    const table = within(dialog).getByRole('table', { name: tr('fr', 'imports.previewCaption') });
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(within(table).getByText(tr('fr', 'imports.outcome_INVALID_EMAIL'))).toBeVisible();
    expect(within(table).getByText(tr('fr', 'imports.outcome_DUPLICATE_IN_FILE'))).toBeVisible();
    expect(within(table).getByText(tr('fr', 'imports.outcome_OK_COURSES_IGNORED'))).toBeVisible();

    await ue.click(within(dialog).getByRole('checkbox', { name: tr('fr', 'imports.errorsOnly') }));
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).queryByText('sami@example.com')).not.toBeInTheDocument();
  });

  it('a server-side refusal of the file (413 IMPORT_TOO_LARGE) is an error on the file field', async () => {
    api.POST.mockResolvedValue({
      error: { code: 'IMPORT_TOO_LARGE', message: 'x', details: { maxRows: 500, rows: 501 } },
    });
    const dialog = renderDialog();
    const ue = await choose(dialog, csvFile());
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'imports.preview') }));
    expect(await within(dialog).findByText(tr('fr', 'errors.IMPORT_TOO_LARGE'))).toBeVisible();
    expect(
      within(dialog).getByLabelText(tr('fr', 'imports.file'), { exact: false }),
    ).toHaveAttribute('aria-invalid', 'true');
  });

  it('confirm posts without dryRun, polls the status until COMPLETED and links the report', async () => {
    api.POST.mockImplementation(async (_path: string, opts: { params: { query?: object } }) =>
      opts.params.query ? { data: PREVIEW } : { data: { importId: IMPORT_ID } },
    );
    api.GET.mockResolvedValueOnce({ data: status({ status: 'QUEUED' }) })
      .mockResolvedValueOnce({ data: status({ status: 'RUNNING', processedRows: 1 }) })
      .mockResolvedValue({
        data: status({ status: 'COMPLETED', processedRows: 2, createdCount: 2 }),
      });
    const dialog = renderDialog();
    const ue = await choose(dialog, csvFile());
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'imports.preview') }));
    await ue.click(
      await within(dialog).findByRole('button', { name: fill('imports.confirm', { valid: 2 }) }),
    );
    await waitFor(() =>
      expect(api.POST).toHaveBeenLastCalledWith('/workspaces/{wid}/invitations/import', {
        params: { path: { wid: 'w1' } },
        body: { fileName: 'classe.csv', content: CSV },
      }),
    );
    expect(
      await within(dialog).findByText(fill('imports.completed', { created: 2, failed: 0 })),
    ).toBeVisible();
    expect(api.GET).toHaveBeenCalledWith('/workspaces/{wid}/invitations/import/{importId}', {
      params: { path: { wid: 'w1', importId: IMPORT_ID } },
      signal: expect.any(AbortSignal),
    });
    expect(api.GET.mock.calls.length).toBeGreaterThanOrEqual(3);
    const bar = within(dialog).getByRole('progressbar', {
      name: tr('fr', 'imports.progressLabel'),
    });
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuemax', '2');
    const report = within(dialog).getByRole('link', { name: tr('fr', 'imports.report') });
    expect(report).toHaveAttribute(
      'href',
      `/api/v1/workspaces/w1/invitations/import/${IMPORT_ID}/report`,
    );
    expect(report).toHaveAttribute('download');
    expect(onDone).toHaveBeenCalledTimes(1);
    // Polling stopped at the terminal status.
    const calls = api.GET.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.GET.mock.calls.length).toBe(calls);
  });

  it('409 IMPORT_IN_PROGRESS shows an alert and follows the running import', async () => {
    const RUNNING = 'bbbbbbbb-0000-4000-8000-000000000009';
    api.POST.mockImplementation(async (_path: string, opts: { params: { query?: object } }) =>
      opts.params.query
        ? { data: PREVIEW }
        : { error: { code: 'IMPORT_IN_PROGRESS', message: 'x', details: { importId: RUNNING } } },
    );
    api.GET.mockResolvedValue({
      data: status({ status: 'RUNNING', processedRows: 1, validRows: 3 }),
    });
    const dialog = renderDialog();
    const ue = await choose(dialog, csvFile());
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'imports.preview') }));
    await ue.click(
      await within(dialog).findByRole('button', { name: fill('imports.confirm', { valid: 2 }) }),
    );
    expect(await within(dialog).findByText(tr('fr', 'imports.inProgress'))).toBeVisible();
    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith('/workspaces/{wid}/invitations/import/{importId}', {
        params: { path: { wid: 'w1', importId: RUNNING } },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(
      await within(dialog).findByText(fill('imports.progress', { processed: 1, total: 3 })),
    ).toBeVisible();
  });

  it('renders in Arabic (rtl) with translated outcomes', async () => {
    api.POST.mockResolvedValue({ data: PREVIEW });
    const dialog = renderDialog('ar');
    const ue = await choose(dialog, csvFile(), 'ar');
    await ue.click(within(dialog).getByRole('button', { name: tr('ar', 'imports.preview') }));
    expect(
      await within(dialog).findByText(tr('ar', 'imports.outcome_INVALID_EMAIL')),
    ).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
  });
});
