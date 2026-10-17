import {
  CONSENT_VERSIONS,
  dirOf,
  testConsentTermsVersion,
  type CurrentConsentType,
  type MyWorkspace,
} from '@tt/contracts';
import { AppShell, type NavSection } from '@tt/ui';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthRefresher } from '../../../components/auth-refresher';
import { ConsentGate } from '../../../components/consent-gate';
import { TimezoneBanner } from '../../../components/timezone-banner';
import { WorkspaceSwitcher } from '../../../components/workspace-switcher';
import { routing } from '../../../i18n/routing';
import { RESUME_COOKIE } from '../../../lib/auth-refresh';
import { appGateRedirect } from '../../../lib/auth-redirects';
import { sanitizeNext } from '../../../lib/sanitize-next';
import { getSessionResult } from '../../../lib/session';
import { asApiResult, serverApi } from '../../../lib/api';

/** Current version of a consent the ConsentGate must show and grant (server-side env override). */
function consentVersion(type: CurrentConsentType): string {
  if (type === 'TERMS') return testConsentTermsVersion() ?? CONSENT_VERSIONS.TERMS;
  return CONSENT_VERSIONS[type];
}

/**
 * Authenticated app frame. Gate order mirrors `AccountGatesGuard`: no session -> login;
 * unverified email -> verify-email; mandatory 2FA setup -> 2fa/setup; pending consents are
 * rendered in place by the ConsentGate (blocking dialog, grants re-run this layout).
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

  const t = await getTranslations();
  // Temporary single-section nav of the routes that exist; T8 replaces it with the nav model.
  const sections: NavSection[] = [
    {
      id: 'main',
      items: [
        { id: 'dashboard', href: `/${locale}/app`, label: t('nav.dashboard'), icon: null },
        {
          id: 'settings',
          href: `/${locale}/app/settings/profile`,
          label: t('nav.settings'),
          icon: null,
        },
      ],
    },
  ];
  const { data: workspaces } = asApiResult<MyWorkspace[]>(
    await (await serverApi()).GET('/me/workspaces'),
  );

  return (
    <AppShell
      locale={locale}
      dir={dirOf(locale)}
      brand={{ name: t('common.appName'), href: `/${locale}/app` }}
      sections={sections}
      labels={{
        skipToContent: t('nav.skipToContent'),
        primaryNav: t('nav.primaryNav'),
        secondaryNav: t('nav.secondaryNav'),
        more: t('nav.more'),
        closeMenu: t('nav.closeMenu'),
        brandHome: t('nav.brandHome'),
      }}
      topBarStart={<WorkspaceSwitcher workspaces={workspaces ?? []} />}
    >
      <AuthRefresher />
      <TimezoneBanner timezone={user.timezone} />
      {children}
      {user.pendingConsents.length > 0 ? (
        <ConsentGate
          pending={user.pendingConsents}
          versions={Object.fromEntries(
            user.pendingConsents.map((type) => [type, consentVersion(type)]),
          )}
        />
      ) : null}
    </AppShell>
  );
}
