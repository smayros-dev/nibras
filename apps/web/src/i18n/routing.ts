import { DEFAULT_LOCALE, LOCALES } from '@tt/contracts';
import { defineRouting } from 'next-intl/routing';

/**
 * Every page lives under `/{locale}`. Detection on `/` (proxy): `NEXT_LOCALE` cookie, then
 * `Accept-Language` (best match, so `ar-TN` -> `ar`), then the default `fr`.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
  localeDetection: true,
});

declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
  }
}
