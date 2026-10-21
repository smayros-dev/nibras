import type { WorkspaceDetail } from '@nibras/contracts';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../../../lib/api';
import { getSession } from '../../../../../../../lib/session';
import { StudentsPanel } from '../../../../../../../components/students-panel';

/** Workspace students page (PRD §9.1 Étudiants, §8.3; SP2 design §8): `?tab=pending` opens En attente. */
export default async function WorkspaceStudentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; wid: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { locale, wid } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [{ data: detail }, me, { tab }] = await Promise.all([
    serverApi()
      .then((client) => client.GET('/workspaces/{wid}', { params: { path: { wid } } }))
      .then((result) => asApiResult<WorkspaceDetail>(result)),
    getSession(),
    searchParams,
  ]);
  // A STUDENT (or any role without the page) gets the same 404 as an unknown workspace.
  if (!detail || !me || !['OWNER', 'ADMIN', 'TEACHER'].includes(detail.myRole)) notFound();
  return (
    <StudentsPanel
      wid={wid}
      detail={detail}
      meId={me.id}
      initialTab={tab === 'pending' ? 'pending' : 'all'}
    />
  );
}
