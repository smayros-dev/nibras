import type { MeUser } from '@tt/contracts';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../../i18n/routing';
import { getSession } from '../../../../../../lib/session';
import { ProfileForm } from './profile-form';

export default async function ProfileSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const user = (await getSession()) as MeUser;

  return <ProfileForm user={user} />;
}
