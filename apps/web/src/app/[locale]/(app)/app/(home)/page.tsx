import type { MyWorkspace } from '@nibras/contracts';
import { Badge, Button, Card, EmptyState, PageHeader } from '@nibras/ui';
import { Building2 } from 'lucide-react';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { OnboardingChecklist } from '../../../../../components/onboarding-checklist';
import { Link } from '../../../../../i18n/navigation';
import { routing } from '../../../../../i18n/routing';
import { membershipStatusBadge } from '../../../../../lib/membership-status';
import { getSession } from '../../../../../lib/session';
import { asApiResult, serverApi } from '../../../../../lib/api';

export default async function AppHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations();
  // The layout already guarantees a session; this is the page's own read for the welcome name.
  const user = await getSession();

  const { data } = asApiResult<MyWorkspace[]>(await (await serverApi()).GET('/me/workspaces'));
  const workspaces = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('app.welcome', { name: user?.firstName ?? '' })} />
      {user ? (
        <OnboardingChecklist
          emailVerified={user.emailVerifiedAt !== null}
          profileComplete={
            user.firstName.length > 0 && user.lastName.length > 0 && user.phoneVerifiedAt !== null
          }
          workspaces={workspaces}
        />
      ) : null}
      <Card>
        <Card.Header>
          <Card.Title>{t('workspace.createTitle')}</Card.Title>
        </Card.Header>
        {workspaces.length === 0 ? (
          <EmptyState
            as="h3"
            icon={<Building2 />}
            title={t('settings.workspaces.emptyTitle')}
            description={t('settings.workspaces.emptyDescription')}
            action={
              <Button variant="primary" asChild>
                <Link href="/app/settings/workspaces">{t('settings.workspaces.manage')}</Link>
              </Button>
            }
          />
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border">
              {workspaces.map((m) => (
                <li
                  key={m.workspace.id}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2"
                >
                  <Link
                    href={`/app/w/${m.workspace.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {m.workspace.name}
                  </Link>
                  <span className="flex flex-wrap gap-2">
                    <Badge variant="neutral">
                      {m.workspace.type === 'ORGANIZATION'
                        ? t('workspace.typeOrganization')
                        : t('workspace.typePersonal')}
                    </Badge>
                    <Badge variant="brand">{t(`members.role_${m.role}`)}</Badge>
                    {m.status === 'ACTIVE' ? null : (
                      <Badge variant={membershipStatusBadge(m.status).variant}>
                        {t(membershipStatusBadge(m.status).labelKey)}
                      </Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <Card.Footer>
              <Button variant="secondary" size="sm" asChild>
                <Link href="/app/settings/workspaces">{t('settings.workspaces.manage')}</Link>
              </Button>
            </Card.Footer>
          </>
        )}
      </Card>
    </div>
  );
}
