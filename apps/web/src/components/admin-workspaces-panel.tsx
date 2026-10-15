'use client';

import type { AdminWorkspace, AdminWorkspacesPage, WorkspaceType } from '@tt/contracts';
import { WORKSPACE_STATUSES } from '@tt/contracts';
import { formatDate } from '@tt/i18n';
import { Button, Field, Select, TextInput } from '@tt/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api, asApiResult } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

const GIB = 1024 ** 3;

/**
 * Super-admin workspaces table (plan Task 22): filter by type/status/name, suspend (reason
 * required) / reactivate, and change the storage quota in GiB.
 */
export function AdminWorkspacesPanel() {
  const t = useTranslations();
  const locale = useLocale();

  const [items, setItems] = useState<AdminWorkspace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | WorkspaceType>('');
  const [workspaceStatus, setWorkspaceStatus] = useState<'' | WorkspaceStatus>('');

  /** Row with an open suspend-reason form. */
  const [suspending, setSuspending] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  /** Row with an open quota input, plus its GiB value. */
  const [quotaRow, setQuotaRow] = useState<string | null>(null);
  const [quotaGiB, setQuotaGiB] = useState('');

  const load = useCallback(async () => {
    const { data, error: getError } = asApiResult<AdminWorkspacesPage>(
      await api.GET('/admin/workspaces', {
        params: {
          query: {
            ...(q ? { q } : {}),
            ...(type ? { type } : {}),
            ...(workspaceStatus ? { status: workspaceStatus } : {}),
            limit: 50,
          },
        },
      }),
    );
    if (getError) setError(apiErrorMessage(t, getError as unknown));
    else {
      setError(null);
      setItems(data?.items ?? []);
    }
  }, [q, type, workspaceStatus, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const suspend = async (wid: string) => {
    const { error: postError } = asApiResult(
      await api.POST('/admin/workspaces/{wid}/suspend', {
        params: { path: { wid } },
        body: { reason },
      }),
    );
    if (postError) setError(apiErrorMessage(t, postError as unknown));
    else {
      setStatus(t('admin.workspaces.suspended'));
      setSuspending(null);
      setReason('');
      await load();
    }
  };

  const reactivate = async (wid: string) => {
    const { error: postError } = asApiResult(
      await api.POST('/admin/workspaces/{wid}/unsuspend', { params: { path: { wid } } }),
    );
    if (postError) setError(apiErrorMessage(t, postError as unknown));
    else {
      setStatus(t('admin.workspaces.reactivated'));
      await load();
    }
  };

  const saveQuota = async (wid: string) => {
    const bytes = BigInt(Math.round(Number(quotaGiB) * GIB)).toString();
    const { error: patchError } = asApiResult(
      await api.PATCH('/admin/workspaces/{wid}/quota', {
        params: { path: { wid } },
        body: { storageQuotaBytes: bytes },
      }),
    );
    if (patchError) setError(apiErrorMessage(t, patchError as unknown));
    else {
      setStatus(t('admin.workspaces.quotaSaved'));
      setQuotaRow(null);
      setQuotaGiB('');
      await load();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field htmlFor="admin-ws-q" label={t('admin.workspaces.search')}>
          <TextInput id="admin-ws-q" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field htmlFor="admin-ws-type" label={t('admin.workspaces.type')}>
          <Select
            id="admin-ws-type"
            value={type}
            onChange={(e) => setType(e.target.value as '' | WorkspaceType)}
          >
            <option value="">—</option>
            <option value="PERSONAL">{t('workspace.typePersonal')}</option>
            <option value="ORGANIZATION">{t('workspace.typeOrganization')}</option>
          </Select>
        </Field>
        <Field htmlFor="admin-ws-status" label={t('admin.workspaces.status')}>
          <Select
            id="admin-ws-status"
            value={workspaceStatus}
            onChange={(e) => setWorkspaceStatus(e.target.value as '' | WorkspaceStatus)}
          >
            <option value="">—</option>
            <option value="ACTIVE">{t('admin.workspaceStatus.ACTIVE')}</option>
            <option value="SUSPENDED">{t('admin.workspaceStatus.SUSPENDED')}</option>
          </Select>
        </Field>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="text-sm text-success">
          {status}
        </p>
      ) : null}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-300">
            <th className="py-1 text-start">{t('admin.workspaces.type')}</th>
            <th className="py-1 text-start">{t('admin.workspaces.name')}</th>
            <th className="py-1 text-start">{t('admin.workspaces.members')}</th>
            <th className="py-1 text-start">{t('admin.workspaces.storage')}</th>
            <th className="py-1 text-start">{t('admin.workspaces.status')}</th>
            <th className="py-1 text-start">{t('admin.workspaces.createdAt')}</th>
            <th className="py-1 text-start" />
          </tr>
        </thead>
        <tbody>
          {items.map((ws) => (
            <tr key={ws.id} data-testid={`admin-ws-${ws.id}`} className="border-b border-gray-100">
              <td className="py-1">
                {ws.type === 'PERSONAL'
                  ? t('workspace.typePersonal')
                  : t('workspace.typeOrganization')}
              </td>
              <td className="py-1">{ws.name}</td>
              <td className="py-1">{ws.memberCount}</td>
              <td className="py-1 font-mono text-xs">
                {ws.storageUsedBytes} / {ws.storageQuotaBytes}
              </td>
              <td className="py-1">
                {ws.status === 'SUSPENDED'
                  ? t('admin.workspaceStatus.SUSPENDED')
                  : t('admin.workspaceStatus.ACTIVE')}
              </td>
              <td className="py-1">{formatDate(new Date(ws.createdAt), locale, 'UTC')}</td>
              <td className="py-1">
                <div className="flex flex-wrap items-end gap-2">
                  {ws.status === 'ACTIVE' ? (
                    suspending === ws.id ? (
                      <>
                        <Field
                          htmlFor={`admin-ws-reason-${ws.id}`}
                          label={t('admin.workspaces.reason')}
                        >
                          <TextInput
                            id={`admin-ws-reason-${ws.id}`}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        </Field>
                        <Button
                          variant="danger"
                          onClick={() => void suspend(ws.id)}
                          disabled={reason.trim().length === 0}
                        >
                          {t('admin.workspaces.confirm')}
                        </Button>
                        <Button variant="secondary" onClick={() => setSuspending(null)}>
                          {t('common.cancel')}
                        </Button>
                      </>
                    ) : (
                      <Button variant="danger" onClick={() => setSuspending(ws.id)}>
                        {t('admin.workspaces.suspend')}
                      </Button>
                    )
                  ) : (
                    <Button variant="primary" onClick={() => void reactivate(ws.id)}>
                      {t('admin.workspaces.reactivate')}
                    </Button>
                  )}
                  {quotaRow === ws.id ? (
                    <>
                      <Field
                        htmlFor={`admin-ws-quota-${ws.id}`}
                        label={t('admin.workspaces.quotaGiB')}
                      >
                        <TextInput
                          id={`admin-ws-quota-${ws.id}`}
                          type="number"
                          min={0}
                          value={quotaGiB}
                          onChange={(e) => setQuotaGiB(e.target.value)}
                        />
                      </Field>
                      <Button
                        variant="primary"
                        onClick={() => void saveQuota(ws.id)}
                        disabled={quotaGiB.trim() === ''}
                      >
                        {t('admin.workspaces.saveQuota')}
                      </Button>
                      <Button variant="secondary" onClick={() => setQuotaRow(null)}>
                        {t('common.cancel')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuotaRow(ws.id);
                        setQuotaGiB(String(Math.round(Number(ws.storageQuotaBytes) / GIB)));
                      }}
                    >
                      {t('admin.workspaces.quota')}
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {items.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-2 text-gray-500">
                {t('admin.workspaces.empty')}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
