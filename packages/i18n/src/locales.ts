import type { Locale } from '@nibras/contracts';
import ar from '../messages/ar.json';
import en from '../messages/en.json';
import fr from '../messages/fr.json';

/** Nested message catalogue; structurally identical to next-intl's `AbstractIntlMessages`. */
export type AbstractIntlMessages = { [key: string]: AbstractIntlMessages | string };

/**
 * Message catalogues per locale. `fr` is the reference key set; API error messages live
 * under `errors.<ERROR_CODE>`.
 */
export const messages: Record<Locale, AbstractIntlMessages> = { fr, ar, en };

export function getMessages(locale: Locale): AbstractIntlMessages {
  return messages[locale];
}

/** Dotted paths of every leaf string, e.g. `['common.appName', 'nav.more', ...]`. */
export function flattenKeys(obj: AbstractIntlMessages, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : flattenKeys(value, path);
  });
}
