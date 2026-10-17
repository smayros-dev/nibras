import { PageHeader } from '@tt/ui';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppFrame } from '../../../../components/app-frame';
import { routing } from '../../../../i18n/routing';
import { getSession } from '../../../../lib/session';

/**
 * Super-admin console: `platformRole === 'SUPER_ADMIN'` or 404 — anonymous and ordinary teachers
 * see the same not-found page (no existence leak). Rendered in the app frame, whose nav model adds
 * the console section (Console, Signalements, Santé) for super-admins.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const user = await getSession();
  if (!user || user.platformRole !== 'SUPER_ADMIN') notFound();

  const t = await getTranslations();

  return (
    <AppFrame locale={locale} user={user}>
      <div className="flex flex-col gap-6">
        <PageHeader title={t('admin.title')} />
        {children}
      </div>
    </AppFrame>
  );
}
