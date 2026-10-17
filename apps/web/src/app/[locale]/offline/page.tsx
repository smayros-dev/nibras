import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { StatusPage } from '../../../components/status-page';
import { routing } from '../../../i18n/routing';
import { RetryButton } from './retry-button';

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale });
  return { title: `${t('pwa.offlineTitle')} · ${t('common.appName')}`, robots: { index: false } };
}

/**
 * The page the service worker serves when a navigation fails (precached per locale, fetched
 * without cookies). Inside the locale layout only (translated, `dir="rtl"` in `ar`), no shell and
 * no API call, so the cached copy holds no user data. SP5 will list the upcoming sessions here.
 */
export default async function OfflinePage({ params }: { params: Params }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pwa' });
  return (
    <StatusPage
      title={t('offlineTitle')}
      description={t('offlineDescription')}
      details={<p className="text-sm text-fg-subtle">{t('offlineSessionsSoon')}</p>}
      actions={<RetryButton />}
    />
  );
}
