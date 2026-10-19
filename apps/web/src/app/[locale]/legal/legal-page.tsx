import { Alert, Badge, PageHeader } from '@nibras/ui';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { BrandMark } from '../../../components/brand-mark';
import { LocaleMenu } from '../../../components/locale-menu';
import { ThemeToggleClient } from '../../../components/theme-provider';
import { Link } from '../../../i18n/navigation';
import { routing } from '../../../i18n/routing';

/**
 * The three documents a user consents to, and the minors notice a guardian accepts (SP2); `key`
 * is their `legal.*` namespace entry.
 */
export type LegalDocument = 'terms' | 'privacy' | 'codeOfConduct' | 'minors';

const TITLE_KEYS: Record<
  LegalDocument,
  'termsTitle' | 'privacyTitle' | 'cocTitle' | 'minorsTitle'
> = {
  terms: 'termsTitle',
  privacy: 'privacyTitle',
  codeOfConduct: 'cocTitle',
  minors: 'minorsTitle',
};

type Params = Promise<{ locale: string }>;

/** `<title>`: the document name, then the product name. */
export async function legalMetadata(params: Params, document: LegalDocument): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale });
  return { title: `${t(`legal.${TITLE_KEYS[document]}`)} · ${t('common.appName')}` };
}

/**
 * Placeholder legal page (spec D12): title, the consent version users accept, an "owner to
 * provide" notice and a short provisional body. The real FR/AR/EN texts are a documentary
 * deliverable (PRD §8.16.2). Public (no session) and dynamically rendered like every page (D8).
 */
export async function LegalPage({
  params,
  document,
  version,
}: {
  params: Params;
  document: LegalDocument;
  version: string;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations();
  const appName = t('common.appName');
  const paragraphs = t(`legal.${document}.body`, { appName }).split(/\n{2,}/);

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
          <BrandMark name={appName} />
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
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 focus:outline-none sm:px-6 sm:py-12"
      >
        <PageHeader
          title={t(`legal.${TITLE_KEYS[document]}`)}
          description={<Badge variant="neutral">{t('legal.version', { version })}</Badge>}
        />
        <Alert variant="info" title={t('legal.placeholderTitle')}>
          {t('legal.placeholder')}
        </Alert>
        <div className="flex flex-col gap-4 leading-relaxed">
          {paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      </main>
    </div>
  );
}
