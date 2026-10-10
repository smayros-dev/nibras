import { z } from 'zod';

/** Supported UI locales: French (default), Arabic (RTL), English. */
export const LOCALES = ['fr', 'ar', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'fr';

export const LocaleSchema = z.enum(LOCALES);

/** True only for Arabic. */
export function isRtl(locale: Locale): boolean {
  return locale === 'ar';
}

/** Value for the `dir` attribute of `<html>`. */
export function dirOf(locale: Locale): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

const INTL_TAGS: Record<Locale, string> = {
  fr: 'fr-FR',
  // Western digits 0-9 in Arabic (D-P16).
  ar: 'ar-TN-u-nu-latn',
  en: 'en-GB',
};

/** BCP 47 tag to pass to `Intl.*` formatters for a locale. */
export function intlTag(locale: Locale): string {
  return INTL_TAGS[locale];
}
