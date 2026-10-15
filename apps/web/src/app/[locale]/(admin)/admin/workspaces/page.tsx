import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../i18n/routing';
import { AdminWorkspacesPanel } from '../../../../../components/admin-workspaces-panel';

export default async function AdminWorkspacesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return <AdminWorkspacesPanel />;
}
