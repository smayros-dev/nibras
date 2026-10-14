import { messages } from '@tt/i18n';
import { expect, test as base, type APIRequestContext } from '@playwright/test';

/**
 * Per-project UI language, set in `playwright.config.ts` (`use: { uiLocale: 'fr' | 'ar' }`,
 * typed through `defineConfig<LocaleTestOptions>`). Named `uiLocale` because Playwright's
 * built-in `locale` option is the browser context language.
 */
export interface LocaleTestOptions {
  uiLocale: 'fr' | 'ar';
}

export const test = base.extend<LocaleTestOptions>({
  uiLocale: ['fr', { option: true }],
});

export { expect };
export type { APIRequestContext };

/**
 * The API is started with this env (`playwright.config.ts` webServer): the current TERMS version
 * is bumped while registration still grants the static `CONSENT_VERSIONS`, so every e2e
 * registered user has a pending TERMS consent and the ConsentGate appears (AC-GDPR-06).
 */
export const TEST_CONSENT_TERMS_VERSION = 'terms-e2e-2026-11';

/** Translated message for a dotted `key`, e.g. `t('fr', 'auth.login.title')`. */
export function t(locale: string, key: string): string {
  let node: unknown = (messages as Record<string, unknown>)[locale];
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null)
      throw new Error(`Unknown message ${key} (${locale})`);
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'string') throw new Error(`Not a message: ${key} (${locale})`);
  return node;
}

/** A unique sign-up address for this millisecond (e2e users are never reused). */
export function uniqueEmail(): string {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}
