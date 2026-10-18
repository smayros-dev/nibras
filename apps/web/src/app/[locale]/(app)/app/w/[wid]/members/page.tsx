import type { WorkspaceDetail } from '@nibras/contracts';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../../../lib/api';
import { getSession } from '../../../../../../../lib/session';
import { MembersPanel } from '../../../../../../../components/members-panel';

/** Workspace members page (PRD §9.2/§11.1). */
export default async function WorkspaceMembersPage({
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
  if (!detail || !me) notFound();
  return <MembersPanel wid={wid} detail={detail} meId={me.id} />;
}
