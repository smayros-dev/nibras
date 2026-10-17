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
 * absent or could leave the origin. A leading `/{locale}` is stripped: next-intl's router adds
 * the current locale itself (`/fr/app` -> `/app`).
 */
export function sanitizeNext(next: string | null | undefined): string | null {
  if (!next || !SAFE_PATH.test(next)) return null;
  let path = next.replace(LOCALE_PREFIX, '');
  if (path === '' || path.startsWith('?') || path.startsWith('#')) path = `/${path}`;
  if (!SAFE_PATH.test(path)) return null;
  // Belt and braces: whatever the parser makes of it must stay on our origin.
  try {
    if (new URL(path, PROBE_ORIGIN).origin !== PROBE_ORIGIN) return null;
  } catch {
    return null;
  }
  return path;
}
