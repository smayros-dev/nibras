import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { negotiateLocale } from './i18n/negotiate';
import { routing } from './i18n/routing';
import { buildCsp, newNonce, securityHeaders } from './lib/security-headers';

const handleI18nRouting = createMiddleware(routing);

const VALID_LOCALES = routing.locales as readonly string[];
const LOCALE_PREFIX = new RegExp(`^/(?:${VALID_LOCALES.join('|')})(?=/|$)`);

/**
 * next-intl routing (cookie `NEXT_LOCALE`, then `Accept-Language`, then `fr`), with the
 * `Accept-Language` header first reduced to the locale our strict negotiation picks: next-intl's
 * own matcher would send `ar-TN,fr;q=0.8` to `/fr` (Review Focus 1).
 *
 * The `tt_locale` cookie (set at register/login from the account's own locale) wins over both:
 * it is copied to `NEXT_LOCALE` before next-intl reads the request cookies.
 *
 * Security headers (spec D7): a fresh nonce per request goes into the CSP, which is set on the
 * request headers next-intl forwards to the render (Next reads the nonce from that CSP and applies
 * it to its scripts; the root layout reads `x-nonce` for next-themes) and on the response, with
 * the other security headers.
 */
export default function proxy(request: NextRequest) {
  const stored = request.cookies.get('tt_locale')?.value;
  if (stored && VALID_LOCALES.includes(stored)) {
    request.cookies.set('NEXT_LOCALE', stored);
  }

  const dev = process.env.NODE_ENV === 'development';
  const nonce = newNonce();
  const csp = buildCsp(nonce, { dev });

  const headers = new Headers(request.headers);
  // Always overwritten, so a client cannot choose the nonce.
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  // The locale-less path (+ query) for server layouts that build a `?next=` deep link; always
  // overwritten, so a client cannot inject it. next-intl forwards these request headers.
  const { pathname, search } = request.nextUrl;
  headers.set('x-pathname', `${pathname.replace(LOCALE_PREFIX, '') || '/'}${search}`);

  const header = request.headers.get('accept-language');
  if (header !== null) {
    const locale = negotiateLocale(header);
    if (locale) headers.set('accept-language', locale);
    else headers.delete('accept-language'); // nothing supported -> default locale
  }
  // Body-less copy: next-intl only reads the URL, headers and cookies, and the original request
  // (with its body, e.g. a server action POST) is the one Next forwards, with these headers.
  const response = handleI18nRouting(
    new NextRequest(request.url, { headers, method: request.method }),
  );
  response.headers.set('Content-Security-Policy', csp);
  for (const [name, value] of Object.entries(securityHeaders({ dev }))) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  // Everything except the API rewrite, the health routes (/health, /health/live, /health/ready),
  // Next internals and files with an extension.
  matcher: ['/((?!api/|health$|health/|_next|_vercel|.*\\..*).*)'],
};
