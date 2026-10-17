import type { WorkspaceDetail } from '@tt/contracts';
import { Badge, PageHeader } from '@tt/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { routing } from '../../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../../lib/api';
import { SuspendedBanner } from '../../../../../../components/suspended-banner';
import { WorkspaceTabs } from './workspace-tabs';

/**
 * A workspace (PRD §9.2): header with its name, type and status, the suspended banner, and the
 * sub-navigation Paramètres · Membres · Journal d'audit.
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
  try {
    const result = asApiResult<WorkspaceDetail>(
      await (await serverApi()).GET('/workspaces/{wid}', { params: { path: { wid } } }),
    );
    detail = result.data ?? null;
  } catch {
    detail = null;
  }
  if (!detail) notFound();

  const t = await getTranslations();
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
