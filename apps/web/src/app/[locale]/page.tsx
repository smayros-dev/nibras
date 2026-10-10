import { dirOf } from '@tt/contracts';
import { AppShell, type NavItem } from '@tt/ui';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { LocaleSwitcher } from '../../components/locale-switcher';
import { routing } from '../../i18n/routing';

const NAV_KEYS = ['dashboard', 'courses', 'sessions', 'messages', 'settings'] as const;

export default async function HelloPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations();

  const nav: NavItem[] = NAV_KEYS.map((key) => ({
    href: `/${locale}/${key}`,
    label: t(`nav.${key}`),
  }));

  return (
    <AppShell locale={locale} dir={dirOf(locale)} nav={nav}>
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold">{t('hello.title')}</h1>
        <p className="text-lg">{t('hello.subtitle')}</p>
        <LocaleSwitcher />
      </div>
    </AppShell>
  );
}
