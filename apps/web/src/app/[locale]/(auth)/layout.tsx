import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { LocaleMenu } from '../../../components/locale-menu';
import { ThemeToggleClient } from '../../../components/theme-provider';
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
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <a
          href={`/${locale}`}
          className="flex min-h-11 items-center gap-2 rounded-md font-semibold focus-visible:outline-2 focus-visible:outline-focus"
        >
          <span
            aria-hidden="true"
            className="inline-flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-fg"
          >
            {t('common.appName').charAt(0)}
          </span>
          <span>{t('common.appName')}</span>
        </a>
        <div className="flex items-center gap-1">
          <LocaleMenu />
          <ThemeToggleClient />
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 items-center justify-center px-4 py-8 focus:outline-none"
      >
        {children}
      </main>
      <footer className="px-4 py-4 text-sm text-fg-muted sm:px-6">
        <nav aria-label={t('shell.legalNav')}>
          <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <li>
              <a
                href={`/${locale}/legal/terms`}
                className="inline-flex min-h-11 items-center hover:text-fg hover:underline"
              >
                {t('legal.termsTitle')}
              </a>
            </li>
            <li>
              <a
                href={`/${locale}/legal/privacy`}
                className="inline-flex min-h-11 items-center hover:text-fg hover:underline"
              >
                {t('legal.privacyTitle')}
              </a>
            </li>
          </ul>
        </nav>
      </footer>
    </div>
  );
}
