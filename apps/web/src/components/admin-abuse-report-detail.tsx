'use client';

import type { AbuseReport, AbuseReportStatus } from '@tt/contracts';
import { ABUSE_REPORT_STATUSES } from '@tt/contracts';
import { formatDate } from '@tt/i18n';
import { Button, Field, Select, TextInput } from '@tt/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api, asApiResult } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

interface UserSnapshot {
  userId?: string;
  firstName?: string;
  lastName?: string;
  membership?: { role?: string; status?: string } | null;
}

/**
 * Super-admin abuse-report detail (plan Task 22): snapshot viewer, status transitions and a
 * resolution text; when the target is a USER with a teaching membership, the reported account
 * can be suspended / reactivated (reason required).
 */
export function AdminAbuseReportDetail({ id }: { id: string }) {
  const t = useTranslations();
  const locale = useLocale();

  const [report, setReport] = useState<AbuseReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [newStatus, setNewStatus] = useState<AbuseReportStatus | ''>('');
  const [resolution, setResolution] = useState('');
  const [reason, setReason] = useState('');
  const [suspending, setSuspending] = useState(false);

  const load = useCallback(async () => {
    const { data, error: getError } = asApiResult<AbuseReport>(
      await api.GET('/admin/abuse-reports/{id}', { params: { path: { id } } }),
    );
    if (getError) setError(apiErrorMessage(t, getError as unknown));
    else {
      setError(null);
      setReport(data ?? null);
      setResolution(data?.resolution ?? '');
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const { error: patchError } = asApiResult(
      await api.PATCH('/admin/abuse-reports/{id}', {
        params: { path: { id } },
        body: {
          ...(newStatus ? { status: newStatus } : {}),
          resolution: resolution.trim() === '' ? null : resolution.trim(),
        },
      }),
    );
    if (patchError) setError(apiErrorMessage(t, patchError as unknown));
    else {
      setStatus(t('admin.reports.saved'));
      await load();
    }
  };

  const suspendUser = async (uid: string) => {
    const { error: postError } = asApiResult(
      await api.POST('/admin/users/{uid}/suspend', {
        params: { path: { uid } },
        body: { reason },
      }),
    );
    if (postError) setError(apiErrorMessage(t, postError as unknown));
    else {
      setStatus(t('admin.reports.userSuspended'));
      setReason('');
    }
  };

  const reactivateUser = async (uid: string) => {
    const { error: postError } = asApiResult(
      await api.POST('/admin/users/{uid}/unsuspend', { params: { path: { uid } } }),
    );
    if (postError) setError(apiErrorMessage(t, postError as unknown));
    else setStatus(t('admin.reports.userReactivated'));
  };

  if (!report && !error) return <p className="text-sm text-gray-500">{t('common.loading')}</p>;
  if (!report) return null;

  const snapshot = report.contextSnapshot as UserSnapshot;
  const isUser = report.entityType === 'USER';
  const teachingMembership = ['TEACHER', 'ADMIN', 'OWNER'].includes(
    snapshot.membership?.role ?? '',
  );

  return (
    <div className="flex flex-col gap-4">
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

      <dl className="flex max-w-2xl flex-col gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="font-semibold">{t('admin.reports.filterCategory')}:</dt>
          <dd>{t(`abuse.category_${report.category}`)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold">{t('admin.workspaces.status')}:</dt>
          <dd data-testid="admin-abuse-status">{t(`abuse.status_${report.status}`)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold">{t('admin.reports.targetType')}:</dt>
          <dd className="font-mono">{report.entityType}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold">{t('admin.reports.reporter')}:</dt>
          <dd>
            {report.reporter.firstName} {report.reporter.lastName}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold">{t('members.joined')}:</dt>
          <dd>{formatDate(new Date(report.createdAt), locale, 'UTC')}</dd>
        </div>
      </dl>

      <section>
        <h2 className="mb-1 text-sm font-semibold">{t('admin.reports.description')}</h2>
        <p className="max-w-2xl whitespace-pre-wrap text-sm">{report.description}</p>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold">{t('admin.reports.snapshot')}</h2>
        <pre
          data-testid="admin-abuse-snapshot"
          className="max-w-2xl overflow-auto rounded bg-gray-50 p-2 text-xs"
        >
          {JSON.stringify(report.contextSnapshot, null, 2)}
        </pre>
      </section>

      <section className="flex max-w-md flex-col gap-3">
        <Field htmlFor="admin-abuse-new-status" label={t('admin.reports.filterStatus')}>
          <Select
            id="admin-abuse-new-status"
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value as AbuseReportStatus | '')}
          >
            <option value="">—</option>
            {ABUSE_REPORT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`abuse.status_${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="admin-abuse-resolution" label={t('admin.reports.resolution')}>
          <TextInput
            id="admin-abuse-resolution"
            value={resolution}
            placeholder={t('admin.reports.resolutionPlaceholder')}
            onChange={(e) => setResolution(e.target.value)}
          />
        </Field>
        <div>
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={!newStatus && resolution === (report.resolution ?? '')}
          >
            {t('admin.reports.save')}
          </Button>
        </div>
      </section>

      {isUser && teachingMembership ? (
        <section className="flex max-w-md flex-col gap-3 border-t border-gray-200 pt-4">
          <h2 className="text-sm font-semibold">{t('admin.reports.userAccount')}</h2>
          {suspending ? (
            <>
              <Field htmlFor="admin-abuse-user-reason" label={t('admin.workspaces.reason')}>
                <TextInput
                  id="admin-abuse-user-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  onClick={() => {
                    void suspendUser(report.entityId);
                    setSuspending(false);
                  }}
                  disabled={reason.trim().length === 0}
                >
                  {t('admin.workspaces.confirm')}
                </Button>
                <Button variant="secondary" onClick={() => setSuspending(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Button variant="danger" onClick={() => setSuspending(true)}>
                {t('admin.reports.suspendTeacher')}
              </Button>
              <Button variant="secondary" onClick={() => void reactivateUser(report.entityId)}>
                {t('admin.reports.reactivateUser')}
              </Button>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
