import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BirthDateSchema,
  isValidTimeZone,
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

describe('TimezoneSchema', () => {
  it('accepts IANA zones and UTC', () => {
    for (const tz of ['Africa/Tunis', 'Europe/Paris', 'Africa/Casablanca', 'UTC']) {
      expect(isValidTimeZone(tz)).toBe(true);
      expect(TimezoneSchema.safeParse(tz).success).toBe(true);
    }
  });

  it('rejects non-IANA names, offsets and empty strings', () => {
    for (const tz of ['Europe/Tunis', 'GMT+1', '+01:00', '', 'africa/tunis', 'Mars/Olympus']) {
      expect(TimezoneSchema.safeParse(tz).success).toBe(false);
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
