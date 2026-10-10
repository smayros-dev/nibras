import type { IntlError } from 'next-intl';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Shared by the server request config and the client provider (functions are not inherited by
 * `NextIntlClientProvider`): a missing or broken message fails dev and the e2e run instead of
 * shipping a raw key (Review Focus 2, AC-I18N-01).
 */
export function onIntlError(error: IntlError): void {
  if (!isProduction) throw error;
  console.error(error);
}

/** Production safety net only: show the key rather than crash the page. */
export function getMessageFallback({
  namespace,
  key,
}: {
  namespace?: string;
  key: string;
}): string {
  return namespace ? `${namespace}.${key}` : key;
}
