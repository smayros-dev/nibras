import { dirOf } from '@tt/contracts';
import { getMessages } from '@tt/i18n';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTimeZone, getTranslations, setRequestLocale } from 'next-intl/server';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { IntlProvider } from '../../components/intl-provider';
import { routing } from '../../i18n/routing';
import '../globals.css';

// Covers both Arabic and Latin glyphs, so one family serves fr/ar/en.
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '600', '700'],
  display: 'swap',
});

type Params = Promise<{ locale: string }>;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'common' });
  return { title: t('appName') };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Params;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // The client provider does not inherit request config; without a timeZone use-intl reports
  // ENVIRONMENT_FALLBACK, which our dev onError turns into a render failure.
  const timeZone = await getTimeZone();

  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body className={plexArabic.className}>
        <IntlProvider locale={locale} messages={getMessages(locale)} timeZone={timeZone}>
          {children}
        </IntlProvider>
      </body>
    </html>
  );
}
