import { dirOf } from '@tt/contracts';
import { AppShell, type NavSection } from '@tt/ui';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { LocaleSwitcher } from '../../components/locale-switcher';
import { routing } from '../../i18n/routing';

export default async function HelloPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
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

  return (
    <AppShell
      locale={locale}
      dir={dirOf(locale)}
      brand={{ name: t('common.appName'), href: `/${locale}` }}
      sections={sections}
      labels={{
        skipToContent: t('nav.skipToContent'),
        primaryNav: t('nav.primaryNav'),
        secondaryNav: t('nav.secondaryNav'),
        more: t('nav.more'),
        closeMenu: t('nav.closeMenu'),
        brandHome: t('nav.brandHome'),
      }}
    >
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold">{t('hello.title')}</h1>
        <p className="text-lg">{t('hello.subtitle')}</p>
        <LocaleSwitcher />
      </div>
    </AppShell>
  );
}
