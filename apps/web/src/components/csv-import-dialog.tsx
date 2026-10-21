'use client';

import { IMPORT_MAX_BYTES } from '@nibras/contracts/web';
import type {
  ImportAccepted,
  ImportPreview,
  ImportRowOutcome,
  InvitationImportStatus,
} from '@nibras/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  Table,
  useSubmit,
  type BadgeVariant,
} from '@nibras/ui';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, asApiResult } from '../lib/api';
import { apiErrorMessage, issuesToFieldErrors } from '../lib/api-error';
import { useAbortableQuery } from '../lib/paged-fetch';
import { useErrorFocus } from '../lib/use-error-focus';

/** The template's header line (spec §4.5 columns). */
const TEMPLATE_HEADER = 'email,first_name,last_name,guardian_email,birth_date,course_codes';
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(`${TEMPLATE_HEADER}\n`)}`;

/** Refusals of the file itself, shown on the file field. */
const FILE_ERRORS = ['IMPORT_TOO_LARGE', 'PAYLOAD_TOO_LARGE', 'VALIDATION_FAILED'];

const OUTCOME_LABELS: Record<ImportRowOutcome, string> = {
  OK: 'imports.outcome_OK',
  OK_COURSES_IGNORED: 'imports.outcome_OK_COURSES_IGNORED',
  OK_GUARDIAN_AT_ACCEPT: 'imports.outcome_OK_GUARDIAN_AT_ACCEPT',
  INVALID_EMAIL: 'imports.outcome_INVALID_EMAIL',
  DUPLICATE_IN_FILE: 'imports.outcome_DUPLICATE_IN_FILE',
  ALREADY_MEMBER: 'imports.outcome_ALREADY_MEMBER',
  ALREADY_INVITED: 'imports.outcome_ALREADY_INVITED',
  INVALID_BIRTH_DATE: 'imports.outcome_INVALID_BIRTH_DATE',
  INVALID_GUARDIAN_EMAIL: 'imports.outcome_INVALID_GUARDIAN_EMAIL',
  CREATED: 'imports.outcome_CREATED',
  FAILED: 'imports.outcome_FAILED',
};

/** A row is importable when its outcome starts with `OK` (the API's `validRows`). */
const isValid = (outcome: ImportRowOutcome) => outcome.startsWith('OK');

function outcomeVariant(outcome: ImportRowOutcome): BadgeVariant {
  if (outcome === 'OK' || outcome === 'CREATED') return 'success';
  if (isValid(outcome)) return 'warning';
  if (outcome === 'ALREADY_MEMBER' || outcome === 'ALREADY_INVITED') return 'neutral';
  return 'danger';
}

const TERMINAL: readonly InvitationImportStatus['status'][] = ['COMPLETED', 'FAILED'];

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file, 'utf-8');
  });
}

type Step =
  | { kind: 'file' }
  | { kind: 'preview'; fileName: string; content: string; preview: ImportPreview }
  | { kind: 'progress'; importId: string; alreadyRunning: boolean };

/**
 * « Importer CSV » on the students page (AC-INV-07, PRD §8.3.4, spec §4.5), loaded on demand by
 * `StudentsPanel` (`next/dynamic`). Three steps: **file** — a `.csv` read with `FileReader` (a
 * file over `IMPORT_MAX_BYTES` is refused before it is read), the column list and a template;
 * **preview** — `POST …/invitations/import?dryRun=true`, the summary and every line with its
 * outcome (filter « Erreurs seulement »), **Importer {n} invitations** confirms (`202 { importId }`);
 * **progress** — `GET …/import/{id}` every `pollMs` until `COMPLETED | FAILED`, then the counts and
 * the report download (`…/report`, the API's CSV). `409 IMPORT_IN_PROGRESS` follows the import
 * already running instead. The file's content never leaves this component except in the request.
 */
export function CsvImportDialog({
  wid,
  open,
  onOpenChange,
  onDone,
  onCloseAutoFocus,
  pollMs = 2000,
}: {
  wid: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** An import reached `COMPLETED` or `FAILED`: the lists have new rows. */
  onDone: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  pollMs?: number;
}) {
  const t = useTranslations();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        size="lg"
        title={t('imports.title')}
        description={t('imports.description')}
        closeLabel={t('common.close')}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <CsvImport wid={wid} onDone={onDone} pollMs={pollMs} />
      </Dialog.Content>
    </Dialog.Root>
  );
}

function CsvImport({ wid, onDone, pollMs }: { wid: string; onDone: () => void; pollMs: number }) {
  const t = useTranslations();
  const [step, setStep] = useState<Step>({ kind: 'file' });
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  // Memoised: a new object every render would re-run the error focus on every render.
  const fieldErrors = useMemo(
    (): Record<string, string> => (fileError ? { file: fileError } : {}),
    [fileError],
  );
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);

  const post = async (
    fileName: string,
    content: string,
    dryRun: boolean,
  ): Promise<{ data?: unknown; error?: unknown }> =>
    asApiResult<unknown>(
      await api.POST('/workspaces/{wid}/invitations/import', {
        params: { path: { wid }, ...(dryRun ? { query: { dryRun: 'true' as const } } : {}) },
        body: { fileName, content },
      }),
    );

  const preview = useSubmit(async () => {
    setFormError(null);
    if (!file) {
      setFileError(t('imports.fileRequired'));
      return;
    }
    if (file.size > IMPORT_MAX_BYTES) {
      setFileError(t('imports.fileTooLarge'));
      return;
    }
    setFileError(null);
    let content: string;
    try {
      content = await readText(file);
    } catch {
      setFileError(t('imports.readFailed'));
      return;
    }
    let result: { data?: unknown; error?: unknown };
    try {
      result = await post(file.name, content, true);
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    if (result.error || !result.data) {
      const code = (result.error as { code?: string } | undefined)?.code;
      if (code && FILE_ERRORS.includes(code)) {
        const onContent = issuesToFieldErrors(t, result.error).content;
        setFileError(onContent ?? apiErrorMessage(t, result.error));
      } else setFormError(apiErrorMessage(t, result.error ?? null));
      return;
    }
    setErrorsOnly(false);
    setStep({
      kind: 'preview',
      fileName: file.name,
      content,
      preview: result.data as ImportPreview,
    });
  });

  const confirm = useSubmit(async () => {
    if (step.kind !== 'preview') return;
    setFormError(null);
    let result: { data?: unknown; error?: unknown };
    try {
      result = await post(step.fileName, step.content, false);
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    if (result.error || !result.data) {
      const body = result.error as { code?: string; details?: { importId?: unknown } } | undefined;
      const running = body?.details?.importId;
      if (body?.code === 'IMPORT_IN_PROGRESS' && typeof running === 'string') {
        setStep({ kind: 'progress', importId: running, alreadyRunning: true });
        return;
      }
      setFormError(apiErrorMessage(t, result.error ?? null));
      return;
    }
    setStep({
      kind: 'progress',
      importId: (result.data as ImportAccepted).importId,
      alreadyRunning: false,
    });
  });

  const errorAlert = formError ? (
    <Alert ref={alertRef} tabIndex={-1} variant="danger">
      {formError}
    </Alert>
  ) : null;

  if (step.kind === 'progress') {
    return (
      <ImportProgress
        wid={wid}
        importId={step.importId}
        alreadyRunning={step.alreadyRunning}
        onDone={onDone}
        pollMs={pollMs}
      />
    );
  }

  if (step.kind === 'preview') {
    const { totalRows, validRows, rows } = step.preview;
    const shown = errorsOnly ? rows.filter((r) => !isValid(r.outcome)) : rows;
    return (
      <div className="flex flex-col gap-4">
        {errorAlert}
        <p className="font-medium text-fg" role="status">
          {t('imports.summary', { valid: validRows, invalid: totalRows - validRows })}
        </p>
        <Checkbox
          label={t('imports.errorsOnly')}
          checked={errorsOnly}
          onCheckedChange={(checked) => setErrorsOnly(checked === true)}
        />
        <div className="max-h-80 overflow-y-auto rounded-md border border-border">
          <Table caption={t('imports.previewCaption')} hideCaption>
            <Table.Head>
              <Table.Row>
                <Table.Th>{t('imports.line')}</Table.Th>
                <Table.Th>{t('imports.email')}</Table.Th>
                <Table.Th>{t('imports.outcome')}</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {shown.map((r) => (
                <Table.Row key={r.line}>
                  <Table.Td label={t('imports.line')}>{r.line}</Table.Td>
                  <Table.Td label={t('imports.email')}>
                    <span className="break-all">{r.email}</span>
                  </Table.Td>
                  <Table.Td label={t('imports.outcome')}>
                    <Badge variant={outcomeVariant(r.outcome)}>
                      {t(OUTCOME_LABELS[r.outcome])}
                    </Badge>
                  </Table.Td>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          {shown.length === 0 ? (
            <p className="p-4 text-sm text-fg-muted">{t('imports.noErrors')}</p>
          ) : null}
        </div>
        <Dialog.Footer>
          <Button
            variant="secondary"
            onClick={() => {
              setFormError(null);
              setStep({ kind: 'file' });
            }}
          >
            {t('imports.back')}
          </Button>
          <Button
            variant="primary"
            loading={confirm.busy}
            disabled={validRows === 0}
            onClick={() => void confirm.submit()}
          >
            {t('imports.confirm', { valid: validRows })}
          </Button>
        </Dialog.Footer>
      </div>
    );
  }

  return (
    <form
      method="post"
      ref={formRef}
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void preview.submit();
      }}
    >
      {errorAlert}
      <Field
        htmlFor="import-file"
        label={t('imports.file')}
        description={t('imports.fileHint')}
        error={fileError ?? undefined}
        required
      >
        <Input
          id="import-file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null;
            setFile(chosen);
            setFormError(null);
            setFileError(
              chosen && chosen.size > IMPORT_MAX_BYTES ? t('imports.fileTooLarge') : null,
            );
          }}
        />
      </Field>
      <a
        href={TEMPLATE_HREF}
        download="nibras-import.csv"
        className="inline-flex min-h-11 items-center gap-2 self-start font-medium text-primary underline"
      >
        <Download aria-hidden="true" className="size-4" />
        {t('imports.template')}
      </a>
      <Dialog.Footer>
        <Dialog.Close asChild>
          <Button variant="secondary">{t('common.cancel')}</Button>
        </Dialog.Close>
        <Button type="submit" variant="primary" loading={preview.busy}>
          {t('imports.preview')}
        </Button>
      </Dialog.Footer>
    </form>
  );
}

function ImportProgress({
  wid,
  importId,
  alreadyRunning,
  onDone,
  pollMs,
}: {
  wid: string;
  importId: string;
  alreadyRunning: boolean;
  onDone: () => void;
  pollMs: number;
}) {
  const t = useTranslations();
  const [tick, setTick] = useState(0);
  const status = useAbortableQuery(
    [wid, importId, tick],
    async (signal) => {
      let result;
      try {
        result = asApiResult<InvitationImportStatus>(
          await api.GET('/workspaces/{wid}/invitations/import/{importId}', {
            params: { path: { wid, importId } },
            signal,
          }),
        );
      } catch {
        throw new Error(t('errors.INTERNAL_ERROR'));
      }
      if (result.error || !result.data) throw new Error(apiErrorMessage(t, result.error ?? null));
      return result.data;
    },
    { debounceMs: 0 },
  );
  const data = status.data;
  const done = data !== undefined && TERMINAL.includes(data.status);

  // Next poll once the answer for this tick is in (never two requests in flight); stops when the
  // import is done or a poll failed (the error is shown).
  const answered = status.current;
  useEffect(() => {
    if (!answered || done) return;
    const timer = setTimeout(() => setTick((n) => n + 1), pollMs);
    return () => clearTimeout(timer);
  }, [answered, tick, done, pollMs]);

  const notified = useRef(false);
  useEffect(() => {
    if (done && !notified.current) {
      notified.current = true;
      onDone();
    }
  }, [done, onDone]);

  const total = data?.validRows ?? 0;
  const processed = data?.processedRows ?? 0;
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      {alreadyRunning ? <Alert variant="warning">{t('imports.inProgress')}</Alert> : null}
      {status.error ? <Alert variant="danger">{status.error}</Alert> : null}
      <div
        role="progressbar"
        aria-label={t('imports.progressLabel')}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={processed}
        className="h-3 w-full overflow-hidden rounded-full bg-bg-subtle"
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {data === undefined || data.status === 'QUEUED'
          ? t('imports.queued')
          : t('imports.progress', { processed, total })}
      </p>
      {data?.status === 'COMPLETED' ? (
        <Alert variant="success">
          {t('imports.completed', { created: data.createdCount, failed: data.failedCount })}
        </Alert>
      ) : null}
      {data?.status === 'FAILED' ? <Alert variant="danger">{t('imports.failed')}</Alert> : null}
      <Dialog.Footer>
        {done ? (
          <a
            href={`/api/v1/workspaces/${wid}/invitations/import/${importId}/report`}
            download
            className="inline-flex min-h-11 items-center gap-2 font-medium text-primary underline"
          >
            <Download aria-hidden="true" className="size-4" />
            {t('imports.report')}
          </a>
        ) : null}
        <Dialog.Close asChild>
          <Button variant={done ? 'primary' : 'secondary'}>{t('common.close')}</Button>
        </Dialog.Close>
      </Dialog.Footer>
    </div>
  );
}
