import { getMessages } from '@tt/i18n';
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { getMessageFallback, onIntlError } from './error-handling';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: getMessages(locale),
    onError: onIntlError,
    getMessageFallback,
  };
});
