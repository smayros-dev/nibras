import { HttpStatus } from '@nestjs/common';
import {
  BirthDateSchema,
  IMPORT_MAX_ROWS,
  InviteEmailSchema,
  isMinor,
  type ImportRow,
  type ImportRowOutcome,
} from '@nibras/contracts';
import { CsvError, parse } from 'csv-parse/sync';
import { ApiError } from '../common/api-error';
import { validationFailed } from '../workspaces/workspaces.service';

/** Names are cut to the invitation's name length (`NameSchema`: 80). */
const NAME_MAX = 80;
/** A raw (invalid) address kept in the report is cut to the RFC's 320 characters. */
const RAW_EMAIL_MAX = 320;
/** At most this many course codes are kept per row (SP3 resolves them; SP2 ignores them). */
const COURSE_CODES_MAX = 50;
const COURSE_CODE_MAX = 64;

/** Report / preview messages (English, stable; the web UI translates the outcome itself). */
const MESSAGES: Partial<Record<ImportRowOutcome, string>> = {
  OK_COURSES_IGNORED: 'Course codes are not supported yet; the student is invited without them',
  OK_GUARDIAN_AT_ACCEPT: 'Minor without a guardian email: it will be asked at acceptance',
  INVALID_EMAIL: 'Invalid email address',
  DUPLICATE_IN_FILE: 'This address appears earlier in the file',
  ALREADY_MEMBER: 'This address already belongs to a member of the workspace',
  ALREADY_INVITED: 'An invitation is already pending for this address',
  INVALID_BIRTH_DATE: 'Invalid birth date (expected YYYY-MM-DD)',
  INVALID_GUARDIAN_EMAIL: 'Invalid guardian email (or the same as the student)',
};

/** The message of an outcome (`undefined` for `OK` / `CREATED`). */
export const outcomeMessage = (outcome: ImportRowOutcome): string | undefined => MESSAGES[outcome];

/** Whether a row with this outcome is imported (`OK`, `OK_COURSES_IGNORED`, `OK_GUARDIAN_AT_ACCEPT`). */
export const isValidOutcome = (outcome: ImportRowOutcome): boolean => outcome.startsWith('OK');

/**
 * The delimiter of the header line: `;` when it has more `;` than `,` outside quotes (the
 * Excel export of FR/AR locales), else `,`.
 */
function detectDelimiter(content: string): ',' | ';' {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const ch of content) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch === ',') commas += 1;
    else if (!quoted && ch === ';') semicolons += 1;
  }
  return semicolons > commas ? ';' : ',';
}

const cell = (record: Record<string, string>, key: string): string => record[key]?.trim() ?? '';
const nameOrNull = (value: string): string | null => (value ? value.slice(0, NAME_MAX) : null);

/**
 * Parses a CSV import (design §4.5; the content is untrusted): UTF-8 with an optional BOM, a
 * header row with an `email` column (case-insensitive, trimmed; unknown columns ignored, the
 * optional ones are `first_name`, `last_name`, `guardian_email`, `birth_date`, `course_codes`),
 * `,` or `;` detected on the header line; blank lines and all-empty records are skipped.
 * Every data row gets an outcome (`ALREADY_*` are decided by the service against the
 * database). `line` is the file line (the header is line 1).
 *
 * Errors: no header / no `email` column / malformed CSV → `422 VALIDATION_FAILED` on
 * `content`; more than `IMPORT_MAX_ROWS` data rows → `413 IMPORT_TOO_LARGE`.
 */
export function parseImportCsv(content: string): { rows: ImportRow[] } {
  const text = content.replace(/^\uFEFF/, '');
  let headers: string[] = [];
  let records: { record: Record<string, string>; info: { lines: number } }[];
  try {
    records = parse(text, {
      delimiter: detectDelimiter(text),
      columns: (header: string[]) => {
        headers = header.map((h) => String(h).trim().toLowerCase());
        return headers;
      },
      bom: true,
      trim: true,
      skip_empty_lines: true,
      skip_records_with_empty_values: true,
      relax_column_count: true,
      // A quote inside an unquoted field is kept as a character (spreadsheet exports do that).
      relax_quotes: true,
      info: true,
    }) as { record: Record<string, string>; info: { lines: number } }[];
  } catch (err) {
    if (err instanceof CsvError) {
      throw validationFailed('content', `Malformed CSV (${err.code})`);
    }
    throw err;
  }
  if (!headers.includes('email')) {
    throw validationFailed('content', 'The file needs a header row with an "email" column');
  }
  if (records.length > IMPORT_MAX_ROWS) {
    throw new ApiError(
      HttpStatus.PAYLOAD_TOO_LARGE,
      'IMPORT_TOO_LARGE',
      `At most ${IMPORT_MAX_ROWS} rows per import`,
      { maxRows: IMPORT_MAX_ROWS, rows: records.length },
    );
  }

  const seen = new Set<string>();
  const rows = records.map(({ record, info }): ImportRow => {
    const rawEmail = cell(record, 'email');
    const parsedEmail = InviteEmailSchema.safeParse(rawEmail);
    const email = parsedEmail.success ? parsedEmail.data : rawEmail.slice(0, RAW_EMAIL_MAX);
    const rawGuardian = cell(record, 'guardian_email');
    const parsedGuardian = rawGuardian ? InviteEmailSchema.safeParse(rawGuardian) : null;
    const birthDate = cell(record, 'birth_date');
    const courseCodes = cell(record, 'course_codes')
      .split(';')
      .map((c) => c.trim().slice(0, COURSE_CODE_MAX))
      .filter(Boolean)
      .slice(0, COURSE_CODES_MAX);

    let outcome: ImportRowOutcome;
    if (!parsedEmail.success) outcome = 'INVALID_EMAIL';
    else if (seen.has(email)) outcome = 'DUPLICATE_IN_FILE';
    else if (birthDate && !BirthDateSchema.safeParse(birthDate).success) {
      outcome = 'INVALID_BIRTH_DATE';
    } else if (parsedGuardian && (!parsedGuardian.success || parsedGuardian.data === email)) {
      outcome = 'INVALID_GUARDIAN_EMAIL';
    } else if (birthDate && !parsedGuardian && isMinor(birthDate)) {
      outcome = 'OK_GUARDIAN_AT_ACCEPT';
    } else if (courseCodes.length > 0) outcome = 'OK_COURSES_IGNORED';
    else outcome = 'OK';
    if (parsedEmail.success) seen.add(email);

    const row: ImportRow = {
      line: info.lines,
      email,
      firstName: nameOrNull(cell(record, 'first_name')),
      lastName: nameOrNull(cell(record, 'last_name')),
      guardianEmail: parsedGuardian?.success
        ? parsedGuardian.data
        : rawGuardian.slice(0, RAW_EMAIL_MAX) || null,
      birthDate: birthDate || null,
      courseCodes,
      outcome,
    };
    const message = outcomeMessage(outcome);
    if (message) row.message = message;
    return row;
  });
  return { rows };
}

/** First characters a spreadsheet reads as a formula (OWASP CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell of a downloadable report: a cell starting like a formula is prefixed with `'`
 * (shown as text by Excel / LibreOffice / Sheets), then quoted when it holds a separator, a
 * quote or a line break.
 */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A report as a UTF-8 CSV with a BOM (Excel opens it with the right encoding), sorted by line. */
export function reportCsv(
  rows: { line: number; email: string; outcome: string; message?: string }[],
): string {
  const lines = [...rows]
    .sort((a, b) => a.line - b.line)
    .map((r) => [r.line, r.email, r.outcome, r.message].map(csvCell).join(','));
  return `\uFEFF${['line,email,outcome,message', ...lines].map((l) => `${l}\r\n`).join('')}`;
}
