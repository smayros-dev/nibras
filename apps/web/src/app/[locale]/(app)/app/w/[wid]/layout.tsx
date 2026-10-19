import type { MyWorkspace, WorkspaceDetail } from '@nibras/contracts';
import { Badge, PageHeader } from '@nibras/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { routing } from '../../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../../lib/api';
import { MembershipPendingPanel } from '../../../../../../components/membership-pending-panel';
import { SuspendedBanner } from '../../../../../../components/suspended-banner';
import { membershipStatusBadge } from '../../../../../../lib/membership-status';
import { WorkspaceTabs } from './workspace-tabs';

/** `403` codes of `GET /workspaces/{wid}` for a member whose membership is not active (SP2). */
const INACTIVE_CODES = ['GUARDIAN_CONSENT_REQUIRED', 'MEMBERSHIP_INACTIVE'];

/**
 * The caller's own non-active membership of `wid` (from `GET /me/workspaces`, which the workspace
 * guard does not gate), or `null`.
 */
async function inactiveMembership(wid: string): Promise<MyWorkspace | null> {
  const { data } = asApiResult<MyWorkspace[]>(await (await serverApi()).GET('/me/workspaces'));
  const own = data?.find((m) => m.workspace.id === wid);
  return own && own.status !== 'ACTIVE' ? own : null;
}

/**
 * A workspace (PRD §9.2): header with its name, type and status, the suspended banner, and the
 * sub-navigation Paramètres · Membres · Journal d'audit. A member whose membership is not active
 * (`403 GUARDIAN_CONSENT_REQUIRED` / `MEMBERSHIP_INACTIVE`: a minor waiting on his guardian, a
 * student waiting on approval) sees the waiting panel instead of the pages (SP2 design §8); any
 * other failure stays a 404.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; wid: string }>;
}) {
  const { locale, wid } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  let detail: WorkspaceDetail | null = null;
  let errorCode: string | undefined;
  try {
    const result = asApiResult<WorkspaceDetail>(
      await (await serverApi()).GET('/workspaces/{wid}', { params: { path: { wid } } }),
    );
    detail = result.data ?? null;
    errorCode = result.error?.code;
  } catch {
    detail = null;
  }
  const t = await getTranslations();

  if (!detail) {
    const pending =
      errorCode && INACTIVE_CODES.includes(errorCode) ? await inactiveMembership(wid) : null;
    if (!pending) notFound();
    const badge = membershipStatusBadge(pending.status);
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={pending.workspace.name}
          description={<Badge variant={badge.variant}>{t(badge.labelKey)}</Badge>}
        />
        <MembershipPendingPanel membership={pending} />
      </div>
    );
  }

  const suspended = detail.status === 'SUSPENDED' || detail.status === 'DELETING';

  return (
    <div className="flex flex-col gap-6">
      {suspended ? <SuspendedBanner status={detail.status as 'SUSPENDED' | 'DELETING'} /> : null}
      <PageHeader
        title={detail.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge variant="neutral">
              {detail.type === 'ORGANIZATION'
                ? t('workspace.typeOrganization')
                : t('workspace.typePersonal')}
            </Badge>
            <Badge variant={suspended ? 'warning' : 'success'}>
              {t(`workspace.status_${detail.status}`)}
            </Badge>
          </span>
        }
      />
      <WorkspaceTabs wid={wid} label={detail.name} />
      <div>{children}</div>
    </div>
  );
}
