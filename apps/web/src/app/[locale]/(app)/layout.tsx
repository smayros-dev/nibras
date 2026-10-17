import { CONSENT_VERSIONS, testConsentTermsVersion } from '@tt/contracts/web';
import type { CurrentConsentType } from '@tt/contracts';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppFrame } from '../../../components/app-frame';
import { ConsentGate } from '../../../components/consent-gate';
import { TimezoneBanner } from '../../../components/timezone-banner';
import { routing } from '../../../i18n/routing';
import { RESUME_COOKIE } from '../../../lib/auth-refresh';
import { appGateRedirect } from '../../../lib/auth-redirects';
import { sanitizeNext } from '../../../lib/sanitize-next';
import { getSessionResult } from '../../../lib/session';

/** Current version of a consent the ConsentGate must show and grant (server-side env override). */
function consentVersion(type: CurrentConsentType): string {
  if (type === 'TERMS') return testConsentTermsVersion() ?? CONSENT_VERSIONS.TERMS;
  return CONSENT_VERSIONS[type];
}

/**
 * Authenticated app frame. Gate order mirrors `AccountGatesGuard`: no session -> login;
 * unverified email -> verify-email; mandatory 2FA setup -> 2fa/setup; pending consents are
 * rendered by the ConsentGate next to an inert frame (blocking dialog, grants re-run this layout).
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const session = await getSessionResult();
  if (session.status === 'error') throw new Error('Session lookup failed');
  if (session.status !== 'ok') {
    // `next` is a locale-less path (`x-pathname`, set by the proxy): next-intl's client router
    // prefixes the locale itself.
    const next = encodeURIComponent(sanitizeNext((await headers()).get('x-pathname')) ?? '/app');
    // An expired access cookie on a server navigation: the browser (which alone holds the refresh
    // cookie) refreshes once on /auth/resume; a second miss within 20 s, or a suspended account
    // (403), goes to login.
    const tried = (await cookies()).get(RESUME_COOKIE) !== undefined;
    const resume = session.status === 'unauthenticated' && !tried;
    redirect(`/${locale}/${resume ? 'auth/resume' : 'login'}?next=${next}`);
  }
  const { user } = session;

  const gate = appGateRedirect(user);
  if (gate) redirect(`/${locale}/${gate}`);

  const gated = user.pendingConsents.length > 0;
  // The gate is a sibling after the frame, which is inert while it is open: the SSR'd frame is
  // unreachable before the dialog hydrates, and Radix also hides it once it has.
  return (
    <>
      <AppFrame locale={locale} user={user} inert={gated}>
        {children}
        {/* After the page: a floating card plus its end-of-page spacer (no layout shift). */}
        <TimezoneBanner timezone={user.timezone} />
      </AppFrame>
      {gated ? (
        <ConsentGate
          // A new pending set or version is a new gate: no error or busy state carried over.
          key={user.pendingConsents.map((type) => `${type}@${consentVersion(type)}`).join(',')}
          pending={user.pendingConsents}
          versions={Object.fromEntries(
            user.pendingConsents.map((type) => [type, consentVersion(type)]),
          )}
        />
      ) : null}
    </>
  );
}
