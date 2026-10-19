import { describe, expect, it } from 'vitest';
import {
  GUARDIAN_CONSENT_TTL_MS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  INVITATION_TTL_MS,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  guardianConsentLink,
  guardianPageLink,
  invitationLink,
  isMinor,
  joinLink,
  maskEmail,
  normaliseInviteCode,
} from './invite-constants';

describe('invite constants', () => {
  it('isMinor: 18th birthday is the first adult day, 29 Feb handled', () => {
    const at = new Date('2026-10-18T12:00:00Z');
    expect(isMinor('2008-10-19', at)).toBe(true);
    expect(isMinor('2008-10-18', at)).toBe(false);
    expect(isMinor('2008-02-29', new Date('2026-02-28T23:59:59Z'))).toBe(true);
    expect(isMinor('2008-02-29', new Date('2026-03-01T00:00:00Z'))).toBe(false);
    // UTC calendar: late on the eve of the birthday (UTC) is still the previous day.
    expect(isMinor('2008-10-19', new Date('2026-10-18T23:30:00Z'))).toBe(true);
    expect(isMinor('1990-01-01')).toBe(false);
  });

  it('maskEmail keeps first char and domain; normaliseInviteCode upper-cases and rejects ambiguity', () => {
    expect(maskEmail('ahmed@example.com')).toBe('a***@example.com');
    expect(maskEmail('a@x.tn')).toBe('*@x.tn');
    expect(normaliseInviteCode(' abcd2345 ')).toBe('ABCD2345');
    expect(normaliseInviteCode('ABCD0OI1')).toBeNull();
    expect(normaliseInviteCode('ABC')).toBeNull();
    expect(normaliseInviteCode('ABCD23456')).toBeNull();
  });

  it('link builders strip trailing slashes and prefix the locale', () => {
    expect(invitationLink('https://x/', 'ar', 'tok')).toBe('https://x/ar/invite/tok');
    expect(joinLink('https://x//', 'fr', 'ABCD2345')).toBe('https://x/fr/join/ABCD2345');
    expect(guardianConsentLink('https://x', 'en', 'tok')).toBe('https://x/en/guardian-consent/tok');
    expect(guardianPageLink('https://x/', 'fr', 'tok')).toBe('https://x/fr/guardian/tok');
  });

  it('pins the constants of the plan', () => {
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 3600 * 1000);
    expect(GUARDIAN_CONSENT_TTL_MS).toBe(14 * 24 * 3600 * 1000);
    expect(INVITE_CODE_ALPHABET).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    expect(INVITE_CODE_ALPHABET).toHaveLength(32);
    expect(INVITE_CODE_LENGTH).toBe(8);
    expect(IMPORT_MAX_ROWS).toBe(500);
    expect(IMPORT_MAX_BYTES).toBe(1_048_576);
  });
});
