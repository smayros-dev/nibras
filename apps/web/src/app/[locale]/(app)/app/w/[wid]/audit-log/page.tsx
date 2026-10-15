import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../../../i18n/routing';
import { AuditLogPanel } from '../../../../../../../components/audit-log-panel';

/** Workspace audit log page (PRD §9.2/§13.4). */
export default async function WorkspaceAuditLogPage({
  params,
}: {
  params: Promise<{ locale: string; wid: string }>;
}) {
  const { locale, wid } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <AuditLogPanel wid={wid} />;
}
