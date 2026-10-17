import type { WorkspaceDetail } from '@tt/contracts';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../../lib/api';
import { SuspendedBanner } from '../../../../../../components/suspended-banner';
import type { ReactNode } from 'react';

/** Sub-navigation of a workspace (PRD §9.2): Paramètres, Membres, Journal d'audit. */
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
  const base = `/${locale}/app/w/${wid}`;
  const links = [
    { href: base, label: t('workspace.navSettings') },
    { href: `${base}/members`, label: t('workspace.navMembers') },
    { href: `${base}/audit-log`, label: t('workspace.navAudit') },
  ];

  return (
    <div>
      {detail.status === 'SUSPENDED' || detail.status === 'DELETING' ? (
        <SuspendedBanner status={detail.status} />
      ) : null}
      <nav
        aria-label={detail.name}
        className="mb-4 flex gap-4 border-b border-gray-200 pb-2 text-sm"
      >
        {links.map((link) => (
          <a key={link.href} href={link.href} className="text-brand-700 hover:underline">
            {link.label}
          </a>
        ))}
      </nav>
      {children}
    </div>
  );
}
