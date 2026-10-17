import type { Locale } from '@tt/contracts';
import { dirOf } from '@tt/contracts';
import { messages } from '@tt/i18n';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
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
 * real catalogue for `locale` and the `Africa/Tunis` time zone (missing keys throw, as in dev).
 * TODO(T3): also wrap in `DirectionProvider` and `ToastProvider` once they exist.
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
        {children}
      </IntlProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}
