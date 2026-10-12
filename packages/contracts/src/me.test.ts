import { describe, expect, it } from 'vitest';
import { ConsentTypeParamSchema, GrantConsentSchema, UpdateMeSchema } from './me';

describe('UpdateMeSchema', () => {
  it('accepts a partial profile and normalises names', () => {
    expect(
      UpdateMeSchema.parse({ firstName: '  Aly ', locale: 'ar', birthDate: '2009-05-01' }),
    ).toEqual({ firstName: 'Aly', locale: 'ar', birthDate: '2009-05-01' });
    expect(UpdateMeSchema.parse({})).toEqual({});
  });

  it.each([
    { timezone: 'Europe/Tunis' },
    { timezone: 'UTC+1' },
    { locale: 'de' },
    { birthDate: '2999-01-01' },
    { birthDate: '1850-01-01' },
    { firstName: '' },
    { email: 'x@example.com' },
    { birthDate: null },
  ])('refuses %o', (input) => {
    expect(UpdateMeSchema.safeParse(input).success).toBe(false);
  });
});

describe('consent inputs', () => {
  it('only account-level consent types are path parameters', () => {
    expect(ConsentTypeParamSchema.safeParse({ type: 'MARKETING' }).success).toBe(true);
    for (const type of ['RECORDING', 'GUARDIAN_PARENTAL', 'terms']) {
      expect(ConsentTypeParamSchema.safeParse({ type }).success).toBe(false);
    }
  });

  it('a version is a non-empty bounded string', () => {
    expect(GrantConsentSchema.safeParse({ version: 'terms-2026-10' }).success).toBe(true);
    expect(GrantConsentSchema.safeParse({ version: '' }).success).toBe(false);
    expect(GrantConsentSchema.safeParse({ version: 'x'.repeat(65) }).success).toBe(false);
  });
});
