import { getMessages } from '@tt/i18n';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

// Arabic counted nouns: 3–10 plural, 11–99 accusative singular, 100+ genitive singular.
describe('ar validation plurals', () => {
  const t = createTranslator({
    locale: 'ar',
    messages: getMessages('ar'),
    namespace: 'validation',
  }) as unknown as (key: string, values: Record<string, number>) => string;

  it('uses the plural, accusative and genitive forms by count', () => {
    expect(t('too_big_string', { max: 5 })).toBe('الحد الأقصى 5 أحرف.');
    expect(t('too_big_string', { max: 50 })).toBe('الحد الأقصى 50 حرفًا.');
    expect(t('too_big_string', { max: 500 })).toBe('الحد الأقصى 500 حرف.');
    expect(t('too_small_string', { min: 12 })).toBe('الحد الأدنى 12 حرفًا.');
    expect(t('too_small_string', { min: 100 })).toBe('الحد الأدنى 100 حرف.');
    expect(t('too_small_array', { min: 20 })).toBe('اختر 20 عنصرًا على الأقل.');
    expect(t('too_small_array', { min: 200 })).toBe('اختر 200 عنصر على الأقل.');
    expect(t('too_big_array', { max: 1000 })).toBe('اختر 1000 عنصر على الأكثر.');
    expect(t('too_big_array', { max: 3 })).toBe('اختر 3 عناصر على الأكثر.');
  });
});
