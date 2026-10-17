import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../../i18n/routing';
import { AdminAbuseReportDetail } from '../../../../../../components/admin-abuse-report-detail';

export default async function AdminAbuseReportDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return <AdminAbuseReportDetail id={id} />;
}
