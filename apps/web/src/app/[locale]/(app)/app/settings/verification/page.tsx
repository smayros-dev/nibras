import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../../i18n/routing';
import { getSession } from '../../../../../../lib/session';
import type { MeUser } from '@tt/contracts';
import { VerificationPanel } from './verification-panel';

export default async function VerificationSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const user = (await getSession()) as MeUser;

  return <VerificationPanel initialPhoneE164={user.phoneE164} />;
}
