'use client';

import type { SessionSummary } from '@tt/contracts';
import { formatDate } from '@tt/i18n';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  SkeletonTable,
  Table,
  useSubmit,
  useToast,
} from '@tt/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from '../i18n/navigation';
import { apiErrorMessage } from '../lib/api-error';
import { api, asApiResult } from '../lib/api';

/**
 * *Appareils connectés* (`GET /auth/sessions`): per-row revoke, *Déconnecter partout* for every
 * session including the current one (the API clears the auth cookies on that call), confirmed in
 * an `AlertDialog`.
 */
export function DevicesList() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Resolved after mount: the server has no viewer time zone (no hydration mismatch).
  const [viewerTimezone, setViewerTimezone] = useState('UTC');

  const load = useCallback(async () => {
    try {
      const { data, error: loadError } = asApiResult<SessionSummary[]>(
        await api.GET('/auth/sessions'),
      );
      if (loadError) setError(apiErrorMessage(t, loadError));
      else setSessions(data ?? []);
    } catch {
      setError(t('errors.INTERNAL_ERROR'));
    }
  }, [t]);

  useEffect(() => {
    setViewerTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    void load();
  }, [load]);

  const revoke = useSubmit(async (id: string) => {
    setError(null);
    try {
      const { error: revokeError } = asApiResult<unknown>(
        await api.DELETE('/auth/sessions/{id}', { params: { path: { id } } }),
      );
      if (revokeError) {
        setError(apiErrorMessage(t, revokeError));
        return;
      }
      toast({ title: t('settings.security.deviceRevoked'), variant: 'success' });
      await load();
    } catch {
      setError(t('errors.INTERNAL_ERROR'));
    }
  });

  const signOutAll = useSubmit(async () => {
    setError(null);
    try {
      const { error: revokeError } = asApiResult<unknown>(await api.DELETE('/auth/sessions'));
      if (revokeError) {
        setError(apiErrorMessage(t, revokeError));
        setConfirmOpen(false);
        return;
      }
      router.push('/login');
    } catch {
      setError(t('errors.INTERNAL_ERROR'));
      setConfirmOpen(false);
    }
  });

  const columns = {
    device: t('settings.security.device'),
    ip: t('settings.security.ip'),
    lastSeen: t('settings.security.lastSeen'),
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {sessions === null ? (
        error ? null : (
          <SkeletonTable />
        )
      ) : (
        <Table caption={t('settings.security.devices')} hideCaption>
          <Table.Head>
            <Table.Row>
              <Table.Th>{columns.device}</Table.Th>
              <Table.Th>{columns.ip}</Table.Th>
              <Table.Th>{columns.lastSeen}</Table.Th>
              <Table.Th>
                <span className="sr-only">{t('settings.consents.actions')}</span>
              </Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {sessions.map((session) => (
              <Table.Row
                key={session.id}
                data-testid={session.current ? 'device-current' : 'device-row'}
              >
                <Table.Td label={columns.device}>
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {session.deviceLabel}
                    {session.current ? (
                      <Badge variant="brand">{t('settings.security.thisDevice')}</Badge>
                    ) : null}
                  </span>
                </Table.Td>
                <Table.Td label={columns.ip}>{session.ip}</Table.Td>
                <Table.Td label={columns.lastSeen}>
                  {formatDate(new Date(session.lastSeenAt), locale, viewerTimezone)}
                </Table.Td>
                <Table.Actions>
                  {session.current ? null : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={revoke.busy}
                      aria-label={t('settings.security.revokeDevice', {
                        device: session.deviceLabel,
                      })}
                      onClick={() => void revoke.submit(session.id)}
                    >
                      {t('settings.security.revoke')}
                    </Button>
                  )}
                </Table.Actions>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
      <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialog.Trigger asChild>
          <Button variant="danger" className="self-start">
            {t('settings.security.signOutAll')}
          </Button>
        </AlertDialog.Trigger>
        <AlertDialog.Content title={t('settings.security.signOutAllConfirm')}>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>
            <AlertDialog.Action
              destructive
              loading={signOutAll.busy}
              onClick={(event) => {
                // Stay open while the request runs: it closes on navigation, or on error.
                event.preventDefault();
                void signOutAll.submit();
              }}
            >
              {t('settings.security.signOutAll')}
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  );
}
