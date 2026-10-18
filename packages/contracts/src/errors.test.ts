import { describe, expect, it } from 'vitest';
import { ApiErrorBodySchema, DEFAULT_LOCALE, QUEUES, dirOf, intlTag } from './index';

describe('@nibras/contracts', () => {
  it('accepts a well-formed error body and rejects unknown codes', () => {
    expect(
      ApiErrorBodySchema.safeParse({ code: 'NOT_FOUND', message: 'x', requestId: 'r1' }).success,
    ).toBe(true);
    expect(
      ApiErrorBodySchema.safeParse({ code: 'NOPE', message: 'x', requestId: 'r1' }).success,
    ).toBe(false);
  });

  it('maps locales to Intl tags with western digits for Arabic', () => {
    expect(intlTag('ar')).toBe('ar-TN-u-nu-latn');
    // Grouping separator varies across ICU versions (',' on Node 22, '.' on ICU 78); digits must be Western.
    expect(new Intl.NumberFormat(intlTag('ar')).format(1234)).toMatch(/^[0-9][,. ]?[0-9]{3}$/);
    expect(dirOf('ar')).toBe('rtl');
    expect(dirOf('fr')).toBe('ltr');
    expect(DEFAULT_LOCALE).toBe('fr');
  });

  it('exposes the six PRD queues', () => {
    expect(Object.values(QUEUES)).toHaveLength(6);
  });
});
