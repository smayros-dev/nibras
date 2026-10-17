import { describe, expect, it } from 'vitest';
import { issuesToFieldErrors } from './api-error';

const missing = new Set(['validation.invalid_format_weird']);
const t = Object.assign(
  (k: string, p?: Record<string, unknown>) => `${k}${p ? JSON.stringify(p) : ''}`,
  { has: (k: string) => !missing.has(k) },
);

function body(...issues: Record<string, unknown>[]): unknown {
  return { code: 'VALIDATION_FAILED', details: { issues } };
}

describe('issuesToFieldErrors', () => {
  it('maps codes to translated messages with bounds', () => {
    expect(
      issuesToFieldErrors(
        t,
        body({
          path: ['password'],
          message: 'x',
          code: 'too_small',
          minimum: 12,
          origin: 'string',
        }),
      ),
    ).toEqual({ password: 'validation.too_small_string{"min":12}' });
  });

  it('chooses the message by origin for both bounds', () => {
    expect(
      issuesToFieldErrors(
        t,
        body(
          { path: ['age'], message: 'x', code: 'too_big', maximum: 120, origin: 'number' },
          { path: ['tags'], message: 'x', code: 'too_small', minimum: 1, origin: 'array' },
          { path: ['bio'], message: 'x', code: 'too_big', maximum: 500, origin: 'string' },
        ),
      ),
    ).toEqual({
      age: 'validation.too_big_number{"max":120}',
      tags: 'validation.too_small_array{"min":1}',
      bio: 'validation.too_big_string{"max":500}',
    });
  });

  it('falls back to validation.invalid for unknown origins, formats, codes and missing codes', () => {
    missing.add('validation.too_small_date');
    expect(
      issuesToFieldErrors(
        t,
        body(
          { path: ['when'], message: 'x', code: 'too_small', minimum: 1, origin: 'date' },
          { path: ['a'], message: 'x', code: 'invalid_format', format: 'weird' },
          { path: ['b'], message: 'x', code: 'unrecognized_keys' },
          { path: ['c'], message: 'x' },
          { path: ['d'], message: 'x', code: 'custom' },
          { path: ['e'], message: 'x', code: 'something_new' },
        ),
      ),
    ).toEqual({
      when: 'validation.invalid',
      a: 'validation.invalid',
      b: 'validation.invalid',
      c: 'validation.invalid',
      d: 'validation.invalid',
      e: 'validation.invalid',
    });
    missing.delete('validation.too_small_date');
  });

  it('maps known formats, invalid_type and invalid_value', () => {
    expect(
      issuesToFieldErrors(
        t,
        body(
          { path: ['email'], message: 'x', code: 'invalid_format', format: 'email' },
          { path: ['name'], message: 'x', code: 'invalid_type', expected: 'string' },
          { path: ['kind'], message: 'x', code: 'invalid_value' },
        ),
      ),
    ).toEqual({
      email: 'validation.invalid_format_email',
      name: 'validation.required',
      kind: 'validation.invalid_value',
    });
  });

  it('maps a non-integer to not_integer and a non-number to not_number', () => {
    expect(
      issuesToFieldErrors(
        t,
        body(
          { path: ['late'], message: 'x', code: 'invalid_type', expected: 'int' },
          { path: ['ratio'], message: 'x', code: 'invalid_type', expected: 'number' },
        ),
      ),
    ).toEqual({ late: 'validation.not_integer', ratio: 'validation.not_number' });
  });

  it('keeps the first issue per field and never shows the wire message', () => {
    const out = issuesToFieldErrors(
      t,
      body(
        {
          path: ['password'],
          message: 'Too small: expected string',
          code: 'too_small',
          minimum: 12,
          origin: 'string',
        },
        { path: ['password'], message: 'other', code: 'too_big', maximum: 256, origin: 'string' },
      ),
    );
    expect(out).toEqual({ password: 'validation.too_small_string{"min":12}' });
    expect(JSON.stringify(out)).not.toContain('expected string');
  });

  it('yields {} for unknown shapes', () => {
    expect(issuesToFieldErrors(t, null)).toEqual({});
    expect(issuesToFieldErrors(t, { code: 'NOT_FOUND' })).toEqual({});
    expect(issuesToFieldErrors(t, body({ path: [], message: 'x', code: 'custom' }))).toEqual({});
  });
});
