import { describe, expect, it } from 'vitest';
import { ApiError } from './api-error';
import { assertVersion, ifMatchVersion, setEtag } from './if-match';

const req = (value?: string | string[]) => ({
  headers: value === undefined ? {} : { 'if-match': value },
});

function thrown(fn: () => void): ApiError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected an ApiError');
}

describe('If-Match (D-P14, spec D8)', () => {
  it('reads the course version from a quoted, bare or weak entity tag', () => {
    expect(ifMatchVersion(req('"7"'))).toBe(7);
    expect(ifMatchVersion(req('7'))).toBe(7);
    expect(ifMatchVersion(req('W/"12"'))).toBe(12);
    expect(ifMatchVersion(req(' "3" '))).toBe(3);
  });

  it('anything else is no version (→ 428 at the check)', () => {
    for (const value of [undefined, '', '*', '"0"', '"1", "2"', 'abc', '"-1"', '"1.5"']) {
      expect(ifMatchVersion(req(value)), String(value)).toBeNull();
    }
    // A repeated header (array) is not one version.
    expect(ifMatchVersion(req(['"1"', '"2"']))).toBeNull();
  });

  it('assertVersion: missing → 428 VERSION_REQUIRED, stale → 409 VERSION_CONFLICT { currentVersion }', () => {
    const missing = thrown(() => assertVersion(4, null));
    expect(missing.getStatus()).toBe(428);
    expect(missing.code).toBe('VERSION_REQUIRED');

    const stale = thrown(() => assertVersion(4, 3));
    expect(stale.getStatus()).toBe(409);
    expect(stale.code).toBe('VERSION_CONFLICT');
    expect(stale.details).toEqual({ currentVersion: 4 });

    expect(() => assertVersion(4, 4)).not.toThrow();
  });

  it('setEtag writes the strong tag of the version', () => {
    const headers: Record<string, string> = {};
    setEtag({ setHeader: (k: string, v: string) => void (headers[k] = v) }, 9);
    expect(headers).toEqual({ ETag: '"9"' });
  });
});
