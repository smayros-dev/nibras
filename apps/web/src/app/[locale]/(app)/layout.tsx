import {
  CONSENT_VERSIONS,
  dirOf,
  testConsentTermsVersion,
  type CurrentConsentType,
} from '@tt/contracts';
import { AppShell, type NavItem } from '@tt/ui';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConsentGate } from '../../../components/consent-gate';
import { routing } from '../../../i18n/routing';
import { appGateRedirect } from '../../../lib/auth-redirects';
import { getSession } from '../../../lib/session';

const NAV_KEYS = ['dashboard', 'courses', 'sessions', 'messages', 'settings'] as const;

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

  const user = await getSession();
  // `next` is a locale-less path: next-intl's client router prefixes the locale itself.
  if (!user) redirect(`/${locale}/login?next=/app`);

  const gate = appGateRedirect(user);
  if (gate) redirect(`/${locale}/${gate}`);

  const t = await getTranslations();
  const nav: NavItem[] = NAV_KEYS.map((key) => ({
    href: `/${locale}/${key}`,
    label: t(`nav.${key}`),
  }));

  return (
    <AppShell
      locale={locale}
      dir={dirOf(locale)}
      nav={nav}
      labels={{ skipToContent: t('nav.skipToContent'), primaryNav: t('nav.primaryNav') }}
    >
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
