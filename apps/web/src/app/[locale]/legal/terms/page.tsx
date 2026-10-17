import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../i18n/routing';

/** Placeholder (title only) so the auth footer link resolves; T13 writes the content. */
export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('legal');
  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-10 text-fg sm:px-6">
      <h1 className="text-2xl font-semibold">{t('termsTitle')}</h1>
    </main>
  );
}
