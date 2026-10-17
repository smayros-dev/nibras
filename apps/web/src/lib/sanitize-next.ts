import { LOCALES } from '@tt/contracts';

/**
 * A same-origin path: one leading `/` not followed by `/` or `\`, no backslash anywhere (browsers
 * read `\` as `/`), no control character (the URL parser drops tab/CR/LF, so `/\t/evil` would
 * become `//evil`).
 */
// eslint-disable-next-line no-control-regex -- control characters are exactly what it rejects
const SAFE_PATH = /^\/(?![/\\])[^\\\u0000-\u001f\u007f]*$/;
const LOCALE_PREFIX = new RegExp(`^/(?:${LOCALES.join('|')})(?=[/?#]|$)`);
const PROBE_ORIGIN = 'http://next.invalid';

/**
 * The `?next=` deep link as a locale-less same-origin path (`/app/...`), or `null` when it is
 * absent or could leave the origin. The path is returned as the URL parser normalises it (dot
 * segments resolved: `/..//evil` would otherwise become `//evil` in the browser) and re-checked.
 * A leading `/{locale}` is stripped: next-intl's router adds the current locale itself
 * (`/fr/app` -> `/app`).
 */
export function sanitizeNext(next: string | null | undefined): string | null {
  if (!next || !SAFE_PATH.test(next)) return null;
  let path: string;
  try {
    const url = new URL(next, PROBE_ORIGIN);
    if (url.origin !== PROBE_ORIGIN) return null;
    path = `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
  if (!SAFE_PATH.test(path)) return null;
  path = path.replace(LOCALE_PREFIX, '');
  if (path === '' || path.startsWith('?') || path.startsWith('#')) path = `/${path}`;
  return SAFE_PATH.test(path) ? path : null;
}
