import { intlTag } from '@nibras/contracts/web';
import type { Locale } from '@nibras/contracts';

/** Formats a date in the viewer's time zone, always with the Gregorian calendar. */
export function formatDate(
  date: Date,
  locale: Locale,
  timeZone: string,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    timeZone,
    calendar: 'gregory',
    ...opts,
  }).format(date);
}

/** Formats a number with the locale's separators (Western digits in Arabic). */
export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(intlTag(locale)).format(n);
}
