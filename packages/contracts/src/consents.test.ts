import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONSENT_VERSIONS,
  CurrentConsentTypes,
  REQUIRED_CONSENTS,
  testConsentTermsVersion,
} from './consents';
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

describe('testConsentTermsVersion (e2e TERMS override)', () => {
  afterEach(() => vi.unstubAllEnvs());

  function withEnv(env: Record<string, string | undefined>) {
    vi.stubEnv('TEST_CONSENT_TERMS_VERSION', 'terms-e2e');
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    return testConsentTermsVersion();
  }

  it('applies outside production builds', () => {
    expect(withEnv({ NODE_ENV: 'development', APP_ENV: undefined })).toBe('terms-e2e');
    expect(withEnv({ NODE_ENV: 'test', APP_ENV: undefined })).toBe('terms-e2e');
  });

  it('is ignored by a production build unless the deployment says APP_ENV=development', () => {
    expect(withEnv({ NODE_ENV: 'production', APP_ENV: undefined })).toBeUndefined();
    expect(withEnv({ NODE_ENV: 'production', APP_ENV: 'production' })).toBeUndefined();
    expect(withEnv({ NODE_ENV: 'production', APP_ENV: 'staging' })).toBeUndefined();
    // The e2e suite runs the production web build (standalone server) with APP_ENV=development.
    expect(withEnv({ NODE_ENV: 'production', APP_ENV: 'development' })).toBe('terms-e2e');
  });

  it('is undefined when the variable is unset or empty', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('TEST_CONSENT_TERMS_VERSION', '');
    expect(testConsentTermsVersion()).toBeUndefined();
  });
});
