'use client';

import type { ConsentRecord } from '@tt/contracts';
import { formatDate } from '@tt/i18n';
import { Button } from '@tt/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api, asApiResult } from '../../../../../../lib/api';

/** Granted account-level consents with version and date; only MARKETING may be withdrawn. */
export function ConsentsList() {
  const t = useTranslations();
  const locale = useLocale();
  const viewerTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [records, setRecords] = useState<ConsentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = asApiResult<ConsentRecord[]>(await api.GET('/me/consents'));
    if (loadError) setError(t('errors.INTERNAL_ERROR'));
    else setRecords(data ?? []);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(type: ConsentRecord['type']) {
    setError(null);
    const { error: revokeError } = await api.POST('/me/consents/{type}/revoke', {
      params: { path: { type } },
    });
    if (revokeError) setError(t('errors.INTERNAL_ERROR'));
    else await load();
  }

  return (
    <div className="max-w-xl">
      {error ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2 text-sm">
        {(records ?? []).map((record) => (
          <li
            key={`${record.type}-${record.version}-${record.grantedAt}`}
            className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 px-3 py-2"
          >
            <span className="flex-1">
              {t(
                `auth.consent.${record.type === 'CODE_OF_CONDUCT' ? 'coc' : record.type.toLowerCase()}`,
              )}
            </span>
            <span className="text-xs text-gray-500">
              {t('settings.consents.version')}: {record.version}
            </span>
            <span className="text-xs text-gray-500">
              {t('settings.consents.grantedAt', {
                date: formatDate(new Date(record.grantedAt), locale, viewerTimezone),
              })}
            </span>
            {record.type === 'MARKETING' && record.current ? (
              <Button variant="secondary" onClick={() => void revoke(record.type)}>
                {t('settings.consents.revoke')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {records && records.length === 0 ? (
        <p className="text-sm text-gray-500">{t('settings.consents.none')}</p>
      ) : null}
    </div>
  );
}
