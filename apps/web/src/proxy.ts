import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { negotiateLocale } from './i18n/negotiate';
import { routing } from './i18n/routing';

const handleI18nRouting = createMiddleware(routing);

const VALID_LOCALES = routing.locales as readonly string[];

/**
 * next-intl routing (cookie `NEXT_LOCALE`, then `Accept-Language`, then `fr`), with the
 * `Accept-Language` header first reduced to the locale our strict negotiation picks: next-intl's
 * own matcher would send `ar-TN,fr;q=0.8` to `/fr` (Review Focus 1).
 *
 * The `tt_locale` cookie (set at register/login from the account's own locale) wins over both:
 * it is copied to `NEXT_LOCALE` before next-intl reads the request cookies.
 */
export default function proxy(request: NextRequest) {
  const stored = request.cookies.get('tt_locale')?.value;
  if (stored && VALID_LOCALES.includes(stored)) {
    request.cookies.set('NEXT_LOCALE', stored);
  }

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
  // Everything except the API rewrite, the health routes (/health, /health/live, /health/ready),
  // Next internals and files with an extension.
  matcher: ['/((?!api/|health$|health/|_next|_vercel|.*\\..*).*)'],
};
