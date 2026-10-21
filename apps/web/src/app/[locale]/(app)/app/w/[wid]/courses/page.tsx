import type { WorkspaceDetail } from '@nibras/contracts';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../../../lib/api';
import { getSession } from '../../../../../../../lib/session';
import { CoursesPanel } from '../../../../../../../components/courses/courses-panel';

/** Workspace courses page (PRD §9.1 Cours, §8.4.1; SP3): staff roles only, like Étudiants. */
export default async function WorkspaceCoursesPage({
  params,
}: {
  params: Promise<{ locale: string; wid: string }>;
}) {
  const { locale, wid } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [{ data: detail }, me] = await Promise.all([
    serverApi()
      .then((client) => client.GET('/workspaces/{wid}', { params: { path: { wid } } }))
      .then((result) => asApiResult<WorkspaceDetail>(result)),
    getSession(),
  ]);
  // A STUDENT (or any role without the page) gets the same 404 as an unknown workspace.
  if (!detail || !me || !['OWNER', 'ADMIN', 'TEACHER'].includes(detail.myRole)) notFound();
  return <CoursesPanel wid={wid} detail={detail} meId={me.id} />;
}
