'use client';

import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { getMessageFallback, onIntlError } from '../i18n/error-handling';

/** `NextIntlClientProvider` with the same error policy as the server (functions cannot cross RSC). */
export function IntlProvider(
  props: Omit<ComponentProps<typeof NextIntlClientProvider>, 'onError' | 'getMessageFallback'>,
) {
  return (
    <NextIntlClientProvider
      {...props}
      onError={onIntlError}
      getMessageFallback={getMessageFallback}
    />
  );
}
