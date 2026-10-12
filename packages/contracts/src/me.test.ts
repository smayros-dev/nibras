import { describe, expect, it } from 'vitest';
import {
  ConsentTypeParamSchema,
  GrantConsentSchema,
  PhoneOtpRequestSchema,
  PhoneOtpVerifySchema,
  TeacherVerificationSchema,
  UpdateMeSchema,
} from './me';

describe('phone OTP inputs', () => {
  it('accepts a valid E.164 number', () => {
    expect(PhoneOtpRequestSchema.parse({ phoneE164: '+21655123456' })).toEqual({
      phoneE164: '+21655123456',
    });
    expect(PhoneOtpRequestSchema.parse({ phoneE164: ' +33612345678 ' })).toEqual({
      phoneE164: '+33612345678',
    });
  });

  it.each([
    '0612345678',
    '+216 55 123 456',
    '21655123456',
    '+2165512345',
    '+999123456789',
    '+33000000000',
    '',
    `+${'1'.repeat(40)}`,
  ])('refuses %j', (phoneE164) => {
    expect(PhoneOtpRequestSchema.safeParse({ phoneE164 }).success).toBe(false);
  });

  it('a code is 6 digits named otpCode', () => {
    expect(PhoneOtpVerifySchema.parse({ otpCode: ' 123456 ' })).toEqual({ otpCode: '123456' });
    expect(PhoneOtpVerifySchema.safeParse({ otpCode: '12345' }).success).toBe(false);
    expect(PhoneOtpVerifySchema.safeParse({ code: '123456' }).success).toBe(false);
  });

  it('verification status lists the missing steps', () => {
    expect(
      TeacherVerificationSchema.parse({
        emailVerified: true,
        phoneVerified: false,
        codeOfConductAccepted: false,
        missing: ['PHONE', 'CODE_OF_CONDUCT'],
      }).missing,
    ).toEqual(['PHONE', 'CODE_OF_CONDUCT']);
    expect(
      TeacherVerificationSchema.safeParse({
        emailVerified: true,
        phoneVerified: true,
        codeOfConductAccepted: true,
        missing: ['ID'],
      }).success,
    ).toBe(false);
  });
});

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
