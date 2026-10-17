import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../../i18n/routing';
import { getSession } from '../../../../../../lib/session';
import { VerificationPanel } from './verification-panel';

export default async function VerificationSettingsPage({
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

  return <VerificationPanel initialPhoneE164={user.phoneE164} />;
}
