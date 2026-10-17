import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BrandMark } from '../../../components/brand-mark';
import { LocaleMenu } from '../../../components/locale-menu';
import { ThemeToggleClient } from '../../../components/theme-provider';
import { Link } from '../../../i18n/navigation';
import { routing } from '../../../i18n/routing';

/**
 * Auth screens (spec §5): brand on top, locale menu and theme toggle at top-end, the page's card
 * centred over `bg`, footer links to the legal pages. Session logic lives in the pages.
 */
export default async function AuthLayout({
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

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-[60] focus:rounded-md focus:bg-primary focus:p-3 focus:text-primary-fg"
      >
        {t('nav.skipToContent')}
      </a>
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex min-h-11 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <BrandMark name={t('common.appName')} />
        </Link>
        <div
          role="group"
          aria-label={t('auth.layout.preferences')}
          className="flex items-center gap-1"
        >
          <LocaleMenu />
          <ThemeToggleClient />
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 flex-col items-center justify-center px-4 py-8 focus:outline-none sm:py-12"
      >
        {children}
      </main>
      <footer className="px-4 py-4 text-sm text-fg-muted sm:px-6">
        <nav aria-label={t('shell.legalNav')}>
          <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <li>
              <Link
                href="/legal/terms"
                className="inline-flex min-h-11 items-center hover:text-fg hover:underline"
              >
                {t('legal.termsTitle')}
              </Link>
            </li>
            <li>
              <Link
                href="/legal/privacy"
                className="inline-flex min-h-11 items-center hover:text-fg hover:underline"
              >
                {t('legal.privacyTitle')}
              </Link>
            </li>
          </ul>
        </nav>
      </footer>
    </div>
  );
}
