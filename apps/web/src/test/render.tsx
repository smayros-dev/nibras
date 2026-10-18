import type { Locale } from '@nibras/contracts';
import { dirOf } from '@nibras/contracts';
import { messages } from '@nibras/i18n';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { DirectionProvider, ToastProvider } from '@nibras/ui';
import type { ReactElement, ReactNode } from 'react';
import { IntlProvider } from '../components/intl-provider';

export { mockRouter } from './navigation-mock';

export interface RenderWithIntlOptions extends Omit<RenderOptions, 'wrapper'> {
  locale?: Locale;
  /** Defaults to the locale's direction (`ar` → `rtl`). */
  dir?: 'ltr' | 'rtl';
}

/**
 * Renders `ui` the way the app does: `<html lang dir>` set, wrapped in the intl provider with the
 * real catalogue for `locale` and the `Africa/Tunis` time zone (missing keys throw, as in dev),
 * inside `DirectionProvider` and `ToastProvider` like the locale layout.
 */
export function renderWithIntl(
  ui: ReactElement,
  { locale = 'fr', dir = dirOf(locale), ...options }: RenderWithIntlOptions = {},
): RenderResult {
  document.documentElement.lang = locale;
  document.documentElement.dir = dir;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <IntlProvider locale={locale} messages={messages[locale]} timeZone="Africa/Tunis">
        <DirectionProvider dir={dir}>
          <ToastProvider
            labels={{ close: 'Fermer', region: 'Notifications', toast: 'Notification' }}
          >
            {children}
          </ToastProvider>
        </DirectionProvider>
      </IntlProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}

/** Raw catalogue string for a dotted key (`tr('fr', 'shell.logout')`); throws when missing. */
export function tr(locale: Locale, key: string): string {
  let node: unknown = messages[locale];
  for (const part of key.split('.')) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined;
  }
  if (typeof node !== 'string') throw new Error(`Not a message: ${key} (${locale})`);
  return node;
}
