import { getMessages } from '@tt/i18n';
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

const isProduction = process.env.NODE_ENV === 'production';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: getMessages(locale),
    // A missing or broken message fails dev and the e2e run instead of shipping a raw key.
    onError(error) {
      if (!isProduction) throw error;
      console.error(error);
    },
    // Production safety net only: show the key rather than crash the page.
    getMessageFallback({ namespace, key }) {
      return namespace ? `${namespace}.${key}` : key;
    },
  };
});
