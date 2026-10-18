import { Button, Card } from '@nibras/ui';
import { CalendarClock, Check, ChartNoAxesColumnIncreasing, CirclePlay } from 'lucide-react';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { BrandMark } from '../../components/brand-mark';
import { LocaleMenu } from '../../components/locale-menu';
import { ThemeToggleClient } from '../../components/theme-provider';
import { Link } from '../../i18n/navigation';
import { routing } from '../../i18n/routing';
import { getSession } from '../../lib/session';

/** Signed in or not; an unreachable API must not take the landing page down with it. */
async function isSignedIn(): Promise<boolean> {
  try {
    return (await getSession()) !== null;
  } catch {
    return false;
  }
}

const VALUES = [
  { n: 1, icon: CirclePlay },
  { n: 2, icon: CalendarClock },
  { n: 3, icon: ChartNoAxesColumnIncreasing },
] as const;

/**
 * Landing (spec §5, PRD §1.2): brand, the one-sentence promise, two CTAs, three values, footer
 * with legal links, language and theme. No marketing imagery. Also the PWA start page when signed
 * out; a signed-in visitor gets a single "open the app" CTA.
 */
export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations();
  const signedIn = await isSignedIn();
  const appName = t('common.appName');

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-[60] focus:rounded-md focus:bg-primary focus:p-3 focus:text-primary-fg"
      >
        {t('nav.skipToContent')}
      </a>
      <header className="mx-auto flex w-full max-w-5xl items-center px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex min-h-11 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <BrandMark name={appName} />
        </Link>
      </header>

      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <div
          data-landing-container
          className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 pt-8 pb-16 sm:gap-16 sm:px-6 sm:pt-16 sm:pb-24"
        >
          <section aria-labelledby="landing-title" className="flex max-w-2xl flex-col gap-6">
            <p className="w-fit rounded-full bg-primary-subtle px-3 py-1 text-sm font-semibold text-primary">
              {t('landing.eyebrow')}
            </p>
            <h1
              id="landing-title"
              className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl"
            >
              {t('landing.title')}
            </h1>
            <p className="text-lg text-fg-muted">{t('landing.subtitle')}</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              {signedIn ? (
                <Button asChild variant="primary" size="lg">
                  <Link href="/app">{t('landing.openApp')}</Link>
                </Button>
              ) : (
                <>
                  <Button asChild variant="primary" size="lg">
                    <Link href="/register">{t('landing.register')}</Link>
                  </Button>
                  <Button asChild variant="secondary" size="lg">
                    <Link href="/login">{t('landing.login')}</Link>
                  </Button>
                </>
              )}
            </div>
            <ul
              aria-label={t('landing.highlights')}
              className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-muted"
            >
              {(['trustMobile', 'trustLanguages', 'trustPrivacy'] as const).map((key) => (
                <li key={key} className="flex items-center gap-2">
                  <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
                  {t(`landing.${key}`)}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="landing-values" className="flex flex-col gap-6">
            <h2 id="landing-values" className="text-xl font-semibold">
              {t('landing.valuesTitle')}
            </h2>
            <ul className="grid gap-4 sm:grid-cols-3">
              {VALUES.map(({ n, icon: Icon }) => (
                <li key={n}>
                  <Card className="h-full">
                    <span
                      aria-hidden="true"
                      className="inline-flex size-10 items-center justify-center rounded-md bg-primary-subtle text-primary"
                    >
                      <Icon className="size-5" />
                    </span>
                    <Card.Header>
                      <Card.Title as="h3">{t(`landing.value${n}Title`)}</Card.Title>
                      <Card.Description>{t(`landing.value${n}Body`)}</Card.Description>
                    </Card.Header>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-3 px-4 py-4 text-sm text-fg-muted sm:flex-row sm:justify-between sm:px-6">
          <nav aria-label={t('shell.legalNav')}>
            <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
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
          <div
            role="group"
            aria-label={t('landing.preferences')}
            className="flex items-center gap-1"
          >
            <LocaleMenu />
            <ThemeToggleClient />
          </div>
        </div>
      </footer>
    </div>
  );
}
