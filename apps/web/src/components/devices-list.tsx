'use client';

import type { SessionSummary } from '@tt/contracts';
import { Button } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from '../i18n/navigation';
import { api, asApiResult } from '../lib/api';

/**
 * *Appareils connectés* (`GET /auth/sessions`): per-row revoke, *Déconnecter partout* for every
 * session including the current one (the API clears the auth cookies on that call).
 */
export function DevicesList() {
  const t = useTranslations();
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = asApiResult<SessionSummary[]>(
      await api.GET('/auth/sessions'),
    );
    if (loadError) setError(t('errors.INTERNAL_ERROR'));
    else setSessions(data ?? []);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setError(null);
    const { error: revokeError } = await api.DELETE('/auth/sessions/{id}', {
      params: { path: { id } },
    });
    if (revokeError) setError(t('errors.INTERNAL_ERROR'));
    else await load();
  }

  async function signOutAll() {
    if (!window.confirm(t('settings.security.signOutAllConfirm'))) return;
    setError(null);
    const { error: revokeError } = await api.DELETE('/auth/sessions');
    if (revokeError) {
      setError(t('errors.INTERNAL_ERROR'));
      return;
    }
    router.push('/login');
  }

  return (
    <div>
      {error ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2 text-sm">
        {(sessions ?? []).map((session) => (
          <li
            key={session.id}
            data-testid={session.current ? 'device-current' : 'device-row'}
            className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 px-3 py-2"
          >
            <span className="flex-1">
              {session.deviceLabel} · {session.ip}
            </span>
            {session.current ? (
              <span className="text-xs text-gray-500">{t('settings.security.thisDevice')}</span>
            ) : (
              <Button variant="secondary" onClick={() => void revoke(session.id)}>
                {t('settings.security.disconnect')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <Button variant="danger" onClick={() => void signOutAll()}>
          {t('settings.security.signOutAll')}
        </Button>
      </div>
    </div>
  );
}
