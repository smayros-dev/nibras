import { describe, expect, it } from 'vitest';
import { CONSENT_VERSIONS, CurrentConsentTypes, REQUIRED_CONSENTS } from './consents';
import { ERROR_CODES } from './error-codes';

describe('consents', () => {
  it('pins the current version of every account-level consent', () => {
    expect(CONSENT_VERSIONS).toEqual({
      TERMS: 'terms-2026-10',
      PRIVACY: 'privacy-2026-10',
      CODE_OF_CONDUCT: 'coc-2026-10',
      MARKETING: 'marketing-2026-10',
    });
    expect(Object.keys(CONSENT_VERSIONS)).toEqual([...CurrentConsentTypes]);
  });

  it('requires TERMS and PRIVACY', () => {
    expect(REQUIRED_CONSENTS).toEqual(['TERMS', 'PRIVACY']);
  });
});

describe('ERROR_CODES (SP1)', () => {
  it('keeps SP0 codes first and appends the auth/tenancy codes without duplicates', () => {
    expect(ERROR_CODES.slice(0, 2)).toEqual(['VALIDATION_FAILED', 'NOT_FOUND']);
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining(['EMAIL_TAKEN', 'TEACHER_NOT_VERIFIED', 'TENANT_CONTEXT_MISSING']),
    );
    expect(ERROR_CODES).toHaveLength(9 + 34);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});
