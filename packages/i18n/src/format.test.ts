import { describe, expect, it } from 'vitest';
import { formatDate, formatNumber } from './format';

describe('formatDate', () => {
  it('formats dates in the viewer timezone with western digits in Arabic', () => {
    const d = new Date('2026-10-15T14:00:00Z');
    expect(formatDate(d, 'ar', 'Africa/Tunis', { hour: '2-digit', minute: '2-digit' })).toMatch(
      /15:00|03:00/,
    );
    expect(formatDate(d, 'ar', 'Africa/Tunis', { hour: '2-digit', minute: '2-digit' })).not.toMatch(
      /[٠-٩]/,
    );
    expect(formatDate(d, 'fr', 'Europe/Paris', { hour: '2-digit', minute: '2-digit' })).toContain(
      '16:00',
    );
  });

  it('uses the Gregorian calendar for ar', () => {
    expect(
      formatDate(new Date('2026-10-15T12:00:00Z'), 'ar', 'Africa/Tunis', { year: 'numeric' }),
    ).toContain('2026');
  });
});

describe('formatNumber', () => {
  it('uses western digits in Arabic', () => {
    const out = formatNumber(1234.5, 'ar');
    expect(out).not.toMatch(/[٠-٩]/);
    // Separators come from ICU (ar-TN groups with "." on ICU 78); only pin the digits.
    expect(out.replace(/\D/g, '')).toBe('12345');
  });

  it('formats per locale conventions', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'fr').replace(/\s/g, ' ')).toBe('1 234,5');
  });
});
