import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../i18n/routing';
import { AdminAbuseReportsPanel } from '../../../../../components/admin-abuse-reports-panel';

export default async function AdminAbuseReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return <AdminAbuseReportsPanel />;
}
