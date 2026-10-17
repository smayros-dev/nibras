import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../../i18n/routing';
import { getSession } from '../../../../../../lib/session';
import { SecurityPanel } from './security-panel';

export default async function SecuritySettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // The (app) layout redirects a missing session; render nothing if it lapsed in between.
  const user = await getSession();
  if (!user) return null;

  return <SecurityPanel twoFactor={user.twoFactor} />;
}
