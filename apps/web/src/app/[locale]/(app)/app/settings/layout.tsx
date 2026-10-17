import { PageHeader } from '@tt/ui';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { routing } from '../../../../../i18n/routing';
import { SettingsTabs } from './settings-tabs';

export default async function SettingsLayout({
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
    <div className="flex flex-col gap-6">
      <PageHeader title={t('settings.title')} />
      <SettingsTabs />
      <div>{children}</div>
    </div>
  );
}
