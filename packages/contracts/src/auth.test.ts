import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BirthDateSchema,
  canonicalTimeZone,
  ChangePasswordSchema,
  EmailChangeConfirmResponseSchema,
  EmailChangeConfirmSchema,
  EmailChangeRequestSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  isValidTimeZone,
  LoginSchema,
  RegisterTeacherSchema,
  TimezoneSchema,
  VerifyEmailSchema,
} from './auth';

const valid = {
  kind: 'TEACHER',
  firstName: 'Mohamed',
  lastName: 'Sfaxi',
  email: 'mohamed@example.com',
  password: 'un mot de passe assez long',
  locale: 'fr',
  timezone: 'Africa/Tunis',
  acceptTerms: true,
  acceptPrivacy: true,
};

const runtimeCanonical = (tz: string) =>
  new Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions().timeZone;

describe('TimezoneSchema', () => {
  it('accepts every IANA zone the runtime resolves, aliases included, and UTC', () => {
    for (const tz of [
      'Africa/Tunis',
      'Europe/Paris',
      'Asia/Kolkata',
      'Asia/Calcutta',
      'Europe/Kyiv',
      'America/Argentina/Buenos_Aires',
      'UTC',
    ]) {
      expect(isValidTimeZone(tz)).toBe(true);
      expect(TimezoneSchema.safeParse(tz).success).toBe(true);
    }
  });

  it('outputs the runtime canonical form', () => {
    expect(TimezoneSchema.parse('Africa/Tunis')).toBe('Africa/Tunis');
    expect(TimezoneSchema.parse('UTC')).toBe('UTC');
    expect(TimezoneSchema.parse('africa/tunis')).toBe('Africa/Tunis');
    expect(TimezoneSchema.parse('Asia/Kolkata')).toBe(runtimeCanonical('Asia/Kolkata'));
    expect(TimezoneSchema.parse('Asia/Kolkata')).toBe(TimezoneSchema.parse('Asia/Calcutta'));
    expect(TimezoneSchema.parse('Europe/Kyiv')).toBe(TimezoneSchema.parse('Europe/Kiev'));
    expect(canonicalTimeZone('Europe/Kyiv')).toBe(runtimeCanonical('Europe/Kyiv'));
  });

  it('rejects unknown zones, offsets, legacy names, Etc/* and empty strings', () => {
    for (const tz of [
      'Europe/Tunis',
      'GMT+1',
      '+01:00',
      '',
      'Mars/Olympus',
      'EST5EDT',
      'CET',
      'Etc/GMT+1',
      'Etc/UTC',
      'Africa/Tunis/',
      'Africa/../Tunis',
    ]) {
      expect(TimezoneSchema.safeParse(tz).success).toBe(false);
      expect(canonicalTimeZone(tz)).toBeNull();
    }
  });
});

describe('BirthDateSchema', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts ISO dates from 1900-01-01 to today', () => {
    vi.useFakeTimers({ now: new Date('2026-10-11T12:00:00Z'), toFake: ['Date'] });
    for (const d of ['1900-01-01', '2000-02-29', '2026-10-11']) {
      expect(BirthDateSchema.safeParse(d).success).toBe(true);
    }
  });

  it('rejects future dates, dates before 1900, impossible dates and non-ISO formats', () => {
    vi.useFakeTimers({ now: new Date('2026-10-11T12:00:00Z'), toFake: ['Date'] });
    for (const d of ['2026-10-12', '1899-12-31', '2001-02-29', '2020-13-01', '11/10/2000', '']) {
      expect(BirthDateSchema.safeParse(d).success).toBe(false);
    }
  });
});

describe('RegisterTeacherSchema', () => {
  it('trims names and trims + lowercases the email', () => {
    const out = RegisterTeacherSchema.parse({
      ...valid,
      firstName: '  Mohamed ',
      email: '  Mohamed@Example.COM ',
    });
    expect(out.firstName).toBe('Mohamed');
    expect(out.email).toBe('mohamed@example.com');
  });

  it('rejects invalid locale, timezone, unaccepted terms and bad emails', () => {
    for (const patch of [
      { locale: 'de' },
      { timezone: 'Europe/Tunis' },
      { acceptTerms: false },
      { acceptPrivacy: false },
      { email: 'not-an-email' },
      { firstName: '   ' },
      { kind: 'STUDENT' },
      { password: 'x'.repeat(257) },
    ]) {
      expect(RegisterTeacherSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
    }
  });
});

describe('VerifyEmailSchema', () => {
  it('requires a bounded token string', () => {
    expect(VerifyEmailSchema.safeParse({ token: 'abc' }).success).toBe(true);
    expect(VerifyEmailSchema.safeParse({ token: '' }).success).toBe(false);
    expect(VerifyEmailSchema.safeParse({ token: 'x'.repeat(513) }).success).toBe(false);
  });
});

describe('LoginSchema', () => {
  it('normalises the email like registration and defaults remember to false', () => {
    expect(LoginSchema.parse({ email: '  Ahmed@Example.COM ', password: 'x' })).toEqual({
      email: 'ahmed@example.com',
      password: 'x',
      remember: false,
    });
  });

  it('refuses a missing password, a malformed email and a non-boolean remember', () => {
    expect(LoginSchema.safeParse({ email: 'a@example.com', password: '' }).success).toBe(false);
    expect(LoginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
    expect(
      LoginSchema.safeParse({ email: 'a@example.com', password: 'x', remember: 'yes' }).success,
    ).toBe(false);
  });
});

describe('password reset, password change and email change schemas', () => {
  it('normalise the email at forgot-password and email change like registration', () => {
    expect(ForgotPasswordSchema.parse({ email: ' Ahmed@Example.COM ' })).toEqual({
      email: 'ahmed@example.com',
    });
    expect(
      EmailChangeRequestSchema.parse({ newEmail: ' New@Example.com', password: 'x' }).newEmail,
    ).toBe('new@example.com');
    expect(ForgotPasswordSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });

  it('bound passwords to 256 characters and new ones to at least 12', () => {
    const strong = 'un mot de passe assez long';
    expect(ResetPasswordSchema.safeParse({ token: 't', newPassword: strong }).success).toBe(true);
    expect(ResetPasswordSchema.safeParse({ token: 't', newPassword: 'court' }).success).toBe(false);
    expect(
      ResetPasswordSchema.safeParse({ token: 't', newPassword: 'a'.repeat(257) }).success,
    ).toBe(false);
    expect(ResetPasswordSchema.safeParse({ token: '', newPassword: strong }).success).toBe(false);
    expect(
      ChangePasswordSchema.safeParse({ currentPassword: 'x', newPassword: strong }).success,
    ).toBe(true);
    expect(
      ChangePasswordSchema.safeParse({ currentPassword: '', newPassword: strong }).success,
    ).toBe(false);
    expect(
      ChangePasswordSchema.safeParse({ currentPassword: 'a'.repeat(257), newPassword: strong })
        .success,
    ).toBe(false);
    expect(
      EmailChangeRequestSchema.safeParse({ newEmail: 'a@example.com', password: 'a'.repeat(257) })
        .success,
    ).toBe(false);
  });

  it('confirm takes a bounded token and answers the pending side or null', () => {
    expect(EmailChangeConfirmSchema.safeParse({ token: 'x'.repeat(513) }).success).toBe(false);
    for (const pending of ['OLD', 'NEW', null]) {
      expect(EmailChangeConfirmResponseSchema.safeParse({ pending }).success).toBe(true);
    }
    expect(EmailChangeConfirmResponseSchema.safeParse({ pending: 'BOTH' }).success).toBe(false);
  });
});
