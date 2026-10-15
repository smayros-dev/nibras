'use client';

import type { MyWorkspace } from '@tt/contracts';
import { Button, Field, TextInput } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CountrySelect } from './country-select';
import { TimezoneSelect } from './timezone-select';
import { apiErrorMessage } from '../lib/api-error';
import { api, asApiResult } from '../lib/api';

/**
 * PRD §9.1: *Créer une organisation* (name, country, timezone) and *Créer mon espace personnel*
 * — the personal button is hidden when the user already has a PERSONAL workspace, and an API
 * 403 `PERSONAL_WORKSPACE_FORBIDDEN` renders the organization-name message.
 */
export function CreateWorkspacePanel({ workspaces }: { workspaces: MyWorkspace[] }) {
  const t = useTranslations();
  const hasPersonal = workspaces.some((m) => m.workspace.type === 'PERSONAL');

  const [orgName, setOrgName] = useState('');
  const [orgCountry, setOrgCountry] = useState('');
  const [orgTimezone, setOrgTimezone] = useState('Africa/Tunis');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const [busy, setBusy] = useState(false);

  async function createOrganization() {
    setBusy(true);
    setError(null);
    const { error: postError } = asApiResult<unknown>(
      await api.POST('/workspaces', {
        body: {
          name: orgName,
          ...(orgCountry ? { country: orgCountry.toUpperCase() } : {}),
          timezone: orgTimezone,
        },
      }),
    );
    setBusy(false);
    if (postError) setError(apiErrorMessage(t, postError as unknown));
    else setCreated(true);
  }

  async function createPersonal() {
    setBusy(true);
    setError(null);
    const { error: postError } = asApiResult<unknown>(await api.POST('/me/personal-workspace', {}));
    setBusy(false);
    if (postError) {
      const code = (postError as { code?: string }).code;
      const organizationName = (postError as { details?: { organizationName?: string } }).details
        ?.organizationName;
      if (code === 'PERSONAL_WORKSPACE_FORBIDDEN' && organizationName) {
        setError(t('workspace.personalForbidden', { organizationName }));
      } else {
        setError(apiErrorMessage(t, postError as unknown));
      }
      return;
    }
    setCreated(true);
  }

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-xl font-bold">{t('workspace.createTitle')}</h2>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {created ? (
        <p role="status" className="text-sm text-success">
          {t('workspace.created')}
        </p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void createOrganization();
        }}
        className="flex max-w-md flex-col gap-4"
      >
        <h3 className="text-lg font-semibold">{t('workspace.createOrganization')}</h3>
        <Field htmlFor="org-name" label={t('workspace.name')}>
          <TextInput
            id="org-name"
            name="name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
          />
        </Field>
        <Field htmlFor="org-country" label={t('workspace.country')}>
          <CountrySelect id="org-country" value={orgCountry} onChange={setOrgCountry} />
        </Field>
        <Field htmlFor="org-timezone" label={t('workspace.timezone')}>
          <TimezoneSelect
            id="org-timezone"
            value={orgTimezone}
            onChange={(e) => setOrgTimezone(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>
          {t('workspace.submitOrganization')}
        </Button>
      </form>

      {!hasPersonal ? (
        <div className="flex flex-col gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => void createPersonal()}>
            {t('workspace.submitPersonal')}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-gray-500">{t('workspace.personalExists')}</p>
      )}
    </section>
  );
}
