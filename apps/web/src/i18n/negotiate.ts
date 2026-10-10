import { LOCALES, type Locale } from '@tt/contracts';

/**
 * Picks the supported locale from an `Accept-Language` header, honouring the user's order of
 * preference: ranges are taken by descending `q` (header order on ties) and each one matches on its
 * primary language subtag, so `ar-TN,fr;q=0.8` yields `ar`. next-intl's built-in "best fit" matcher
 * prefers the exact `fr` over the regional `ar-TN` there, which is why the proxy normalises the
 * header with this first. Returns `undefined` when nothing supported is acceptable.
 */
export function negotiateLocale(header: string | null | undefined): Locale | undefined {
  if (!header) return undefined;
  const ranges = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const q = qParam === undefined ? 1 : Number(qParam.slice(2));
      return { language: tag.trim().toLowerCase().split('-')[0] ?? '', q, index };
    })
    .filter((range) => Number.isFinite(range.q) && range.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  for (const { language } of ranges) {
    const locale = LOCALES.find((candidate) => candidate === language);
    if (locale) return locale;
  }
  return undefined;
}
