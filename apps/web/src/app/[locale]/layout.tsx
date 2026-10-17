import { dirOf } from '@tt/contracts';
import { getMessages } from '@tt/i18n';
import { BRAND, DirectionProvider, ToastProvider } from '@tt/ui';
import type { Metadata, Viewport } from 'next';
import { hasLocale } from 'next-intl';
import { getTimeZone, getTranslations, setRequestLocale } from 'next-intl/server';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { IntlProvider } from '../../components/intl-provider';
import { SwRegister } from '../../components/sw-register';
import { ThemeProvider } from '../../components/theme-provider';
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

/**
 * `<meta name="color-scheme">`, the per-scheme `theme-color` (browser chrome, PWA) and
 * `viewport-fit=cover`, without which `env(safe-area-inset-*)` is 0 (bottom nav on notched phones).
 */
export const viewport: Viewport = {
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: BRAND.themeColor },
    { media: '(prefers-color-scheme: dark)', color: BRAND.darkThemeColor },
  ],
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'common' });
  // The manifest link comes from `app/manifest.ts`; iOS still reads these instead (PRD §14.6).
  return {
    title: t('appName'),
    icons: {
      icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }],
      apple: '/icons/apple-touch-icon.png',
    },
    appleWebApp: { capable: true, title: BRAND.shortName, statusBarStyle: 'default' },
  };
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
  // CSP nonce for next-themes' inline script; set by the proxy from T15 (absent until then).
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const t = await getTranslations({ locale });
  const dir = dirOf(locale);

  return (
    // `suppressHydrationWarning`: the theme script sets `data-theme` on <html> before hydration.
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className={plexArabic.className}>
        <ThemeProvider nonce={nonce}>
          <IntlProvider locale={locale} messages={getMessages(locale)} timeZone={timeZone}>
            <DirectionProvider dir={dir}>
              <ToastProvider
                labels={{
                  close: t('common.close'),
                  region: t('shell.notifications'),
                  toast: t('shell.notification'),
                }}
              >
                {children}
                <SwRegister />
              </ToastProvider>
            </DirectionProvider>
          </IntlProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
