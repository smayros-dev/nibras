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
    // SP0 (9) + SP1 (34) + SP2 (20, pinned in invitations.test.ts).
    expect(ERROR_CODES).toHaveLength(9 + 34 + 20 + 19); // SP0, SP1, SP2, SP3
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

  it('applies only when the deployment explicitly says APP_ENV=development', () => {
    expect(withEnv({ NODE_ENV: 'development', APP_ENV: 'development' })).toBe('terms-e2e');
    expect(withEnv({ NODE_ENV: 'test', APP_ENV: 'development' })).toBe('terms-e2e');
    // The e2e suite runs the production web build (standalone server) with APP_ENV=development.
    expect(withEnv({ NODE_ENV: 'production', APP_ENV: 'development' })).toBe('terms-e2e');
  });

  it('is ignored for every other tier, whatever NODE_ENV says (allow-list, not deny-list)', () => {
    for (const NODE_ENV of ['development', 'test', 'production', undefined]) {
      expect(withEnv({ NODE_ENV, APP_ENV: undefined })).toBeUndefined();
      expect(withEnv({ NODE_ENV, APP_ENV: '' })).toBeUndefined();
      expect(withEnv({ NODE_ENV, APP_ENV: 'staging' })).toBeUndefined();
      expect(withEnv({ NODE_ENV, APP_ENV: 'production' })).toBeUndefined();
      expect(withEnv({ NODE_ENV, APP_ENV: 'Development' })).toBeUndefined();
      expect(withEnv({ NODE_ENV, APP_ENV: 'dev' })).toBeUndefined();
    }
  });

  it('is undefined when the variable is unset or empty', () => {
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('TEST_CONSENT_TERMS_VERSION', '');
    expect(testConsentTermsVersion()).toBeUndefined();
  });
});
