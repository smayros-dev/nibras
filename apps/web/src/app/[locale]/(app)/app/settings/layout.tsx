import { dirOf } from '@tt/contracts';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { routing } from '../../../../../i18n/routing';

/** PRD §9.1 settings sections; only the live tabs link, the rest are *Bientôt disponible*. */
const LIVE_TABS = ['profile', 'security', 'verification', 'consents', 'workspaces'] as const;
const SOON_TABS = ['notifications', 'organization', 'data'] as const;

export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations();
  const dir = dirOf(locale);

  return (
    <div>
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
      <nav aria-label={t('settings.title')} className="mt-4 border-b border-gray-200">
        <ul className="flex flex-wrap gap-4 text-sm" dir={dir}>
          {LIVE_TABS.map((tab) => (
            <li key={tab}>
              <a
                href={`/${locale}/app/settings/${tab}`}
                className="inline-block border-b-2 border-transparent pb-1 hover:border-brand-600"
              >
                {t(`settings.nav.${tab}`)}
              </a>
            </li>
          ))}
          {SOON_TABS.map((tab) => (
            <li key={tab} className="text-gray-400">
              {t(`settings.nav.${tab}`)} — {t('settings.comingSoon')}
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-6">{children}</div>
    </div>
  );
}
