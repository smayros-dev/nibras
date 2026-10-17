'use client';

import type { MyWorkspace } from '@tt/contracts';
import { Alert, Button, Card, Field, Input, Tabs, useSubmit, useToast } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CountrySelect } from './country-select';
import { TimezoneSelect } from './timezone-select';
import { useRouter } from '../i18n/navigation';
import { apiErrorMessage, issuesToFieldErrors } from '../lib/api-error';
import { api, asApiResult } from '../lib/api';

/**
 * PRD §9.1: *Créer une organisation* (name, country, timezone) and *Créer mon espace personnel*,
 * as two tabs of one card. The personal button is replaced by a note when the user already has a
 * PERSONAL workspace, and an API 403 `PERSONAL_WORKSPACE_FORBIDDEN` renders the organization name.
 * Success toasts and refreshes the server-rendered list.
 */
export function CreateWorkspacePanel({ workspaces }: { workspaces: MyWorkspace[] }) {
  const t = useTranslations();
  const router = useRouter();
  const { toast } = useToast();
  const hasPersonal = workspaces.some((m) => m.workspace.type === 'PERSONAL');

  const [orgName, setOrgName] = useState('');
  const [orgCountry, setOrgCountry] = useState('');
  const [orgTimezone, setOrgTimezone] = useState('Africa/Tunis');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function created() {
    toast({ title: t('workspace.created'), variant: 'success' });
    router.refresh();
  }

  const createOrganization = useSubmit(async () => {
    setError(null);
    setFieldErrors({});
    try {
      const { error: postError } = asApiResult<unknown>(
        await api.POST('/workspaces', {
          body: {
            name: orgName,
            ...(orgCountry ? { country: orgCountry.toUpperCase() } : {}),
            timezone: orgTimezone,
          },
        }),
      );
      if (postError) {
        const mapped = issuesToFieldErrors(t, postError);
        if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
        else setError(apiErrorMessage(t, postError));
        return;
      }
      setOrgName('');
      created();
    } catch {
      setError(t('errors.INTERNAL_ERROR'));
    }
  });

  const createPersonal = useSubmit(async () => {
    setError(null);
    try {
      const { error: postError } = asApiResult<unknown>(
        await api.POST('/me/personal-workspace', {}),
      );
      if (postError) {
        const organizationName = (postError.details as { organizationName?: string } | undefined)
          ?.organizationName;
        setError(
          postError.code === 'PERSONAL_WORKSPACE_FORBIDDEN' && organizationName
            ? t('workspace.personalForbidden', { organizationName })
            : apiErrorMessage(t, postError),
        );
        return;
      }
      created();
    } catch {
      setError(t('errors.INTERNAL_ERROR'));
    }
  });

  const busy = createOrganization.busy || createPersonal.busy;

  return (
    <Card>
      <Card.Header>
        <Card.Title>{t('settings.workspaces.createTitle')}</Card.Title>
      </Card.Header>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <Tabs.Root defaultValue="organization">
        <Tabs.List aria-label={t('settings.workspaces.tabsLabel')}>
          <Tabs.Trigger value="organization">
            {t('settings.workspaces.tabOrganization')}
          </Tabs.Trigger>
          <Tabs.Trigger value="personal">{t('settings.workspaces.tabPersonal')}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="organization">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createOrganization.submit();
            }}
            className="flex max-w-md flex-col gap-4"
          >
            <Field htmlFor="org-name" label={t('workspace.name')} error={fieldErrors.name}>
              <Input
                id="org-name"
                name="name"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
              />
            </Field>
            <Field htmlFor="org-country" label={t('workspace.country')} error={fieldErrors.country}>
              <CountrySelect id="org-country" value={orgCountry} onChange={setOrgCountry} />
            </Field>
            <Field
              htmlFor="org-timezone"
              label={t('workspace.timezone')}
              error={fieldErrors.timezone}
            >
              <TimezoneSelect
                id="org-timezone"
                value={orgTimezone}
                onChange={(e) => setOrgTimezone(e.target.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              className="self-start"
              loading={createOrganization.busy}
              disabled={busy}
            >
              {t('workspace.submitOrganization')}
            </Button>
          </form>
        </Tabs.Content>
        <Tabs.Content value="personal">
          {hasPersonal ? (
            <p className="text-sm text-fg-muted">{t('workspace.personalExists')}</p>
          ) : (
            <Button
              variant="secondary"
              loading={createPersonal.busy}
              disabled={busy}
              onClick={() => void createPersonal.submit()}
            >
              {t('workspace.submitPersonal')}
            </Button>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </Card>
  );
}
