import type { MyWorkspace } from '@tt/contracts';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../../lib/api';
import { CreateWorkspacePanel } from '../../../../../../components/create-workspace-panel';

/** *Vos espaces* (PRD §9.1): list + create organization / personal workspace. */
export default async function WorkspacesSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations();
  const { data: workspaces } = asApiResult<MyWorkspace[]>(
    await (await serverApi()).GET('/me/workspaces'),
  );
  const items = workspaces ?? [];

  return (
    <div className="flex flex-col gap-6">
      <CreateWorkspacePanel workspaces={items} />
      <ul className="flex flex-col gap-2" aria-label={t('workspace.createTitle')}>
        {items.map((m) => (
          <li key={m.workspace.id} className="rounded-md border border-gray-200 px-3 py-2 text-sm">
            <a
              href={`/${locale}/app/w/${m.workspace.id}`}
              className="font-semibold text-brand-700 hover:underline"
            >
              {m.workspace.name}
            </a>{' '}
            —{' '}
            {m.workspace.type === 'ORGANIZATION'
              ? t('workspace.typeOrganization')
              : t('workspace.typePersonal')}{' '}
            ({m.role})
          </li>
        ))}
      </ul>
    </div>
  );
}
