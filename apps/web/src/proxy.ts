import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { negotiateLocale } from './i18n/negotiate';
import { routing } from './i18n/routing';

const handleI18nRouting = createMiddleware(routing);

/**
 * next-intl routing (cookie `NEXT_LOCALE`, then `Accept-Language`, then `fr`), with the
 * `Accept-Language` header first reduced to the locale our strict negotiation picks: next-intl's
 * own matcher would send `ar-TN,fr;q=0.8` to `/fr` (Review Focus 1).
 */
export default function proxy(request: NextRequest) {
  const header = request.headers.get('accept-language');
  if (header === null) return handleI18nRouting(request);

  const headers = new Headers(request.headers);
  const locale = negotiateLocale(header);
  if (locale) headers.set('accept-language', locale);
  else headers.delete('accept-language'); // nothing supported -> default locale
  // Body-less copy: next-intl only reads the URL, headers and cookies, and the original request
  // (with its body, e.g. a server action POST) is the one Next forwards.
  return handleI18nRouting(new NextRequest(request.url, { headers, method: request.method }));
}

export const config = {
  // Everything except the API rewrite, the health route, Next internals and files with an extension.
  matcher: ['/((?!api/|health$|_next|_vercel|.*\\..*).*)'],
};
