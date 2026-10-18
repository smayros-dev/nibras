'use client';

import type { ConsentRecord } from '@nibras/contracts';
import { formatDate } from '@nibras/i18n';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Card,
  EmptyState,
  SkeletonTable,
  Table,
  useSubmit,
  useToast,
} from '@nibras/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage } from '../../../../../../lib/api-error';
import { api, asApiResult } from '../../../../../../lib/api';
import { useReturnFocus } from '../../../../../../lib/use-return-focus';

const consentKey = (type: ConsentRecord['type']) => `settings.consents.types.${type}` as const;

/** Granted account-level consents with version, date and status; only MARKETING may be withdrawn. */
export function ConsentsList() {
  const t = useTranslations();
  const locale = useLocale();
  const { toast } = useToast();
  const [records, setRecords] = useState<ConsentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ConsentRecord['type'] | null>(null);
  // The dialog is shared by the rows (no `Trigger`), so focus goes back to the row that opened it.
  const returnFocus = useReturnFocus();
  // Resolved after mount: the server has no viewer time zone (no hydration mismatch).
  const [viewerTimezone, setViewerTimezone] = useState('UTC');

  const load = useCallback(async () => {
    try {
      const { data, error: loadError } = asApiResult<ConsentRecord[]>(
        await api.GET('/me/consents'),
      );
      if (loadError) setError(apiErrorMessage(t, loadError));
      else setRecords(data ?? []);
    } catch {
      setError(t('errors.INTERNAL_ERROR'));
    }
  }, [t]);

  useEffect(() => {
    setViewerTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    void load();
  }, [load]);

  const revoke = useSubmit(async (type: ConsentRecord['type']) => {
    setError(null);
    try {
      const { error: revokeError } = asApiResult<unknown>(
        await api.POST('/me/consents/{type}/revoke', { params: { path: { type } } }),
      );
      if (revokeError) {
        setError(apiErrorMessage(t, revokeError));
        return;
      }
      toast({ title: t('settings.consents.revoked'), variant: 'success' });
      await load();
    } catch {
      setError(t('errors.INTERNAL_ERROR'));
    } finally {
      setConfirming(null);
    }
  });

  const columns = {
    type: t('settings.consents.type'),
    version: t('settings.consents.version'),
    grantedOn: t('settings.consents.grantedOn'),
    status: t('settings.consents.status'),
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <Card padding="none">
        {records === null ? (
          error ? null : (
            <SkeletonTable className="p-4" />
          )
        ) : records.length === 0 ? (
          <EmptyState title={t('settings.consents.none')} />
        ) : (
          <Table caption={t('settings.consents.title')} hideCaption>
            <Table.Head>
              <Table.Row>
                <Table.Th>{columns.type}</Table.Th>
                <Table.Th>{columns.version}</Table.Th>
                <Table.Th>{columns.grantedOn}</Table.Th>
                <Table.Th>{columns.status}</Table.Th>
                <Table.Th>
                  <span className="sr-only">{t('settings.consents.actions')}</span>
                </Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {records.map((record) => {
                const name = t(consentKey(record.type));
                return (
                  <Table.Row key={`${record.type}-${record.version}-${record.grantedAt}`}>
                    <Table.Td label={columns.type}>{name}</Table.Td>
                    <Table.Td label={columns.version}>{record.version}</Table.Td>
                    <Table.Td label={columns.grantedOn}>
                      {formatDate(new Date(record.grantedAt), locale, viewerTimezone)}
                    </Table.Td>
                    <Table.Td label={columns.status}>
                      {record.revokedAt ? (
                        <Badge variant="neutral">{t('settings.consents.statusRevoked')}</Badge>
                      ) : record.current ? (
                        <Badge variant="success">{t('settings.consents.statusCurrent')}</Badge>
                      ) : (
                        <Badge variant="warning">{t('settings.consents.statusOutdated')}</Badge>
                      )}
                    </Table.Td>
                    <Table.Actions>
                      {record.type === 'MARKETING' && record.current && !record.revokedAt ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(event) => {
                            returnFocus.remember(event.currentTarget);
                            setConfirming(record.type);
                          }}
                        >
                          {t('settings.consents.revoke')}
                        </Button>
                      ) : null}
                    </Table.Actions>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        )}
      </Card>
      <AlertDialog.Root
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        {confirming ? (
          <AlertDialog.Content
            title={t('settings.consents.revokeConfirm', { name: t(consentKey(confirming)) })}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          >
            <AlertDialog.Footer>
              <AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>
              <AlertDialog.Action
                destructive
                loading={revoke.busy}
                onClick={(event) => {
                  // Stay open while the request runs; `revoke` closes it when done.
                  event.preventDefault();
                  void revoke.submit(confirming);
                }}
              >
                {t('settings.consents.revoke')}
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        ) : null}
      </AlertDialog.Root>
    </div>
  );
}
