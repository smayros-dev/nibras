import { IMPORT_MAX_ROWS } from '@nibras/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../common/api-error';
import { csvCell, parseImportCsv, reportCsv } from './csv';

const yearsAgo = (y: number): string => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - y);
  return d.toISOString().slice(0, 10);
};

function apiError(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected an ApiError');
}

describe('parseImportCsv', () => {
  it('strips a UTF-8 BOM, detects the `;` delimiter, matches headers case-insensitively and ignores unknown columns', () => {
    const csv = '\uFEFF Email ;First_Name;LAST_NAME;notes\r\nAhmed@Example.com;Ahmed;Ben Ali;x\r\n';
    const { rows } = parseImportCsv(csv);
    expect(rows).toEqual([
      {
        line: 2,
        email: 'ahmed@example.com',
        firstName: 'Ahmed',
        lastName: 'Ben Ali',
        guardianEmail: null,
        birthDate: null,
        courseCodes: [],
        outcome: 'OK',
      },
    ]);
  });

  it('detects `,` and keeps a quoted `;` inside a field', () => {
    const { rows } = parseImportCsv('email,first_name\na@example.com,"Ali; Jr"\n');
    expect(rows[0]).toMatchObject({ email: 'a@example.com', firstName: 'Ali; Jr', outcome: 'OK' });
  });

  it('a file without an email column → 422 VALIDATION_FAILED on content', () => {
    const err = apiError(() => parseImportCsv('first_name,last_name\nA,B\n'));
    expect(err.getStatus()).toBe(422);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.details).toMatchObject({ issues: [{ path: ['content'] }] });
  });

  it('an empty file or a malformed one (unclosed quote) → 422 VALIDATION_FAILED', () => {
    expect(apiError(() => parseImportCsv('')).code).toBe('VALIDATION_FAILED');
    expect(apiError(() => parseImportCsv('email\n"a@example.com\n')).code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it(`more than ${IMPORT_MAX_ROWS} data rows → 413 IMPORT_TOO_LARGE; exactly ${IMPORT_MAX_ROWS} pass`, () => {
    const lines = (n: number) =>
      ['email', ...Array.from({ length: n }, (_, i) => `s${i}@example.com`)].join('\n');
    expect(parseImportCsv(lines(IMPORT_MAX_ROWS)).rows).toHaveLength(IMPORT_MAX_ROWS);
    const err = apiError(() => parseImportCsv(lines(IMPORT_MAX_ROWS + 1)));
    expect(err.getStatus()).toBe(413);
    expect(err.code).toBe('IMPORT_TOO_LARGE');
  });

  it('an outcome per row; blank lines are skipped and line numbers follow the file', () => {
    const csv = [
      'email,first_name,last_name,guardian_email,birth_date,course_codes',
      'ok@example.com,Ok,One,,,',
      'not-an-email,Bad,Email,,,',
      '',
      'bad-date@example.com,Bad,Date,,2001-02-29,',
      'bad-guardian@example.com,Bad,Guardian,nope,,',
      'self@example.com,Self,Guardian,self@example.com,,',
      `minor@example.com,Mi,Nor,,${yearsAgo(12)},`,
      `minor2@example.com,Mi,Nor,parent@example.com,${yearsAgo(12)},`,
      'courses@example.com,Co,Urses,,,MATH1;PHYS2',
      'OK@Example.com,Dup,Licate,,,',
      ',,,,,',
    ].join('\n');
    const byLine = Object.fromEntries(
      parseImportCsv(csv).rows.map((r) => [r.line, [r.email, r.outcome]]),
    );
    expect(byLine).toEqual({
      2: ['ok@example.com', 'OK'],
      3: ['not-an-email', 'INVALID_EMAIL'],
      5: ['bad-date@example.com', 'INVALID_BIRTH_DATE'],
      6: ['bad-guardian@example.com', 'INVALID_GUARDIAN_EMAIL'],
      7: ['self@example.com', 'INVALID_GUARDIAN_EMAIL'],
      8: ['minor@example.com', 'OK_GUARDIAN_AT_ACCEPT'],
      9: ['minor2@example.com', 'OK'],
      10: ['courses@example.com', 'OK_COURSES_IGNORED'],
      11: ['ok@example.com', 'DUPLICATE_IN_FILE'],
    });
    const courses = parseImportCsv(csv).rows.find((r) => r.line === 10)!;
    expect(courses.courseCodes).toEqual(['MATH1', 'PHYS2']);
  });

  it('duplicates are case-insensitive and only the second occurrence is flagged', () => {
    const { rows } = parseImportCsv('email\nA@x.io\na@X.IO\n b@x.io \nB@x.io\n');
    expect(rows.map((r) => r.outcome)).toEqual([
      'OK',
      'DUPLICATE_IN_FILE',
      'OK',
      'DUPLICATE_IN_FILE',
    ]);
  });

  it('names are trimmed, empty names are null and long names are cut to 80 characters', () => {
    const { rows } = parseImportCsv(`email,first_name,last_name\na@x.io,  ,${'x'.repeat(90)}\n`);
    expect(rows[0]!.firstName).toBeNull();
    expect(rows[0]!.lastName).toHaveLength(80);
  });
});

describe('report CSV output', () => {
  it('neutralises formula cells (=, +, -, @, tab, CR) and quotes separators', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell('plain@example.com')).toBe('plain@example.com');
    expect(csvCell(12)).toBe('12');
  });

  it('starts with a BOM and the header, one CRLF line per row, sorted by line', () => {
    const out = reportCsv([
      { line: 3, email: '=cmd|x', outcome: 'INVALID_EMAIL', message: 'Invalid email' },
      { line: 2, email: 'a@x.io', outcome: 'CREATED' },
    ]);
    expect(out).toBe(
      "\uFEFFline,email,outcome,message\r\n2,a@x.io,CREATED,\r\n3,'=cmd|x,INVALID_EMAIL,Invalid email\r\n",
    );
  });
});
