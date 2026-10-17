// Server component: the zod-bundling entry never reaches the browser from here.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import {
  defaultWorkspaceSettings,
  type MemberSummary,
  type MembersPage,
  type WorkspaceDetail,
  type WorkspaceSettings,
  type WorkspaceStorage,
} from '@tt/contracts';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../../lib/api';
import { WorkspaceSettingsPanel } from '../../../../../../components/workspace-settings-panel';

/** Workspace settings page (PRD §9.2): the panel loads identity, session defaults and storage. */
export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; wid: string }>;
}) {
  const { locale, wid } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const client = await serverApi();

  const { data: detail } = asApiResult<WorkspaceDetail>(
    await client.GET('/workspaces/{wid}', { params: { path: { wid } } }),
  );
  const { data: settings } = asApiResult<WorkspaceSettings>(
    await client.GET('/workspaces/{wid}/settings', { params: { path: { wid } } }),
  );
  const { data: storage } = asApiResult<WorkspaceStorage>(
    await client.GET('/workspaces/{wid}/storage', { params: { path: { wid } } }),
  );
  const { data: adminsPage } = asApiResult<MembersPage>(
    await client.GET('/workspaces/{wid}/members', {
      params: { path: { wid }, query: { role: 'ADMIN', limit: 100 } },
    }),
  );
  const admins: MemberSummary[] = adminsPage?.items ?? [];

  return (
    <WorkspaceSettingsPanel
      wid={wid}
      detail={detail as WorkspaceDetail}
      settings={settings ?? defaultWorkspaceSettings(detail?.defaultTimezone ?? 'UTC')}
      storage={storage ?? null}
      admins={admins}
    />
  );
}
