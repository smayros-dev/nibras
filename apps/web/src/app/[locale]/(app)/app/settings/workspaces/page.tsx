import type { MyWorkspace } from '@tt/contracts';
import { Badge, Card, EmptyState } from '@tt/ui';
import { Building2, ChevronRight, User } from 'lucide-react';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { CreateWorkspacePanel } from '../../../../../../components/create-workspace-panel';
import { Link } from '../../../../../../i18n/navigation';
import { routing } from '../../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../../lib/api';

/** *Vos espaces* (PRD §9.1): create organization / personal workspace, then one card per membership. */
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
    <div className="flex max-w-3xl flex-col gap-6">
      <CreateWorkspacePanel workspaces={items} />
      <section aria-labelledby="my-workspaces-title" className="flex flex-col gap-3">
        <h2 id="my-workspaces-title" className="text-lg font-semibold text-fg">
          {t('workspace.createTitle')}
        </h2>
        {items.length === 0 ? (
          <Card>
            <EmptyState
              as="h3"
              icon={<Building2 />}
              title={t('settings.workspaces.emptyTitle')}
              description={t('settings.workspaces.emptyDescription')}
            />
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((m) => (
              <li key={m.workspace.id}>
                <Card className="h-full">
                  <Card.Header>
                    <Card.Title as="h3" className="flex items-center gap-2">
                      {m.workspace.type === 'ORGANIZATION' ? (
                        <Building2 aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
                      ) : (
                        <User aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
                      )}
                      <Link
                        href={`/app/w/${m.workspace.id}`}
                        className="min-w-0 truncate text-primary hover:underline"
                      >
                        {m.workspace.name}
                      </Link>
                      <ChevronRight
                        aria-hidden="true"
                        className="ms-auto size-4 shrink-0 text-fg-muted rtl:-scale-x-100"
                      />
                    </Card.Title>
                  </Card.Header>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="neutral">
                      {m.workspace.type === 'ORGANIZATION'
                        ? t('workspace.typeOrganization')
                        : t('workspace.typePersonal')}
                    </Badge>
                    <Badge variant="brand">{t(`members.role_${m.role}`)}</Badge>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
