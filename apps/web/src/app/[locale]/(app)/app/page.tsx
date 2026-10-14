import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../i18n/routing';
import { getSession } from '../../../../lib/session';

export default async function AppHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations();
  // The layout already guarantees a session; this is the page's own read for the welcome name.
  const user = await getSession();

  return (
    <h1 className="text-3xl font-bold">{t('app.welcome', { name: user?.firstName ?? '' })}</h1>
  );
}
