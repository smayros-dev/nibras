'use client';

import type {
  AbuseReport,
  AbuseReportsPage,
  AbuseReportStatus,
  AbuseCategory,
} from '@tt/contracts';
import { ABUSE_CATEGORIES, ABUSE_REPORT_STATUSES } from '@tt/contracts';
import { formatDate } from '@tt/i18n';
import { Field, Select, TextInput } from '@tt/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api, asApiResult } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

/**
 * Super-admin abuse queue (plan Task 22): filters (status, category, workspace id) and the
 * MINOR_SAFETY reports pinned first and highlighted (AC-SAFE-05). Rows link to the detail page.
 */
export function AdminAbuseReportsPanel() {
  const t = useTranslations();
  const locale = useLocale();

  const [items, setItems] = useState<AbuseReport[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [reportStatus, setReportStatus] = useState<'' | AbuseReportStatus>('');
  const [category, setCategory] = useState<'' | AbuseCategory>('');
  const [workspaceId, setWorkspaceId] = useState('');

  const load = useCallback(async () => {
    const { data, error: getError } = asApiResult<AbuseReportsPage>(
      await api.GET('/admin/abuse-reports', {
        params: {
          query: {
            ...(reportStatus ? { status: reportStatus } : {}),
            ...(category ? { category } : {}),
            ...(workspaceId.trim() ? { workspaceId: workspaceId.trim() } : {}),
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
  }, [reportStatus, category, workspaceId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Pin MINOR_SAFETY first (server order is newest first; the queue highlights minor safety).
  const sorted = [...items].sort((a, b) => {
    const aMinor = a.category === 'MINOR_SAFETY' ? 0 : 1;
    const bMinor = b.category === 'MINOR_SAFETY' ? 0 : 1;
    return aMinor - bMinor;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field htmlFor="admin-abuse-status" label={t('admin.reports.filterStatus')}>
          <Select
            id="admin-abuse-status"
            value={reportStatus}
            onChange={(e) => setReportStatus(e.target.value as '' | AbuseReportStatus)}
          >
            <option value="">—</option>
            {ABUSE_REPORT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`abuse.status_${status}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="admin-abuse-category" label={t('admin.reports.filterCategory')}>
          <Select
            id="admin-abuse-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as '' | AbuseCategory)}
          >
            <option value="">—</option>
            {ABUSE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`abuse.category_${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="admin-abuse-workspace" label={t('admin.reports.filterWorkspace')}>
          <TextInput
            id="admin-abuse-workspace"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
          />
        </Field>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <p className="text-xs text-gray-500">{t('admin.reports.minorFirst')}</p>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-300">
            <th className="py-1 text-start">{t('admin.reports.filterCategory')}</th>
            <th className="py-1 text-start">{t('admin.workspaces.status')}</th>
            <th className="py-1 text-start">{t('admin.reports.targetType')}</th>
            <th className="py-1 text-start">{t('admin.reports.reporter')}</th>
            <th className="py-1 text-start">{t('members.joined')}</th>
            <th className="py-1 text-start" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((report) => (
            <tr
              key={report.id}
              data-testid={`admin-abuse-${report.id}`}
              data-minor-safety={report.category === 'MINOR_SAFETY' ? 'true' : undefined}
              className={
                report.category === 'MINOR_SAFETY'
                  ? 'border-b border-warning bg-warning/10'
                  : 'border-b border-gray-100'
              }
            >
              <td className="py-1">{t(`abuse.category_${report.category}`)}</td>
              <td className="py-1">{t(`abuse.status_${report.status}`)}</td>
              <td className="py-1">{report.entityType}</td>
              <td className="py-1">
                {report.reporter.firstName} {report.reporter.lastName}
              </td>
              <td className="py-1">{formatDate(new Date(report.createdAt), locale, 'UTC')}</td>
              <td className="py-1">
                <a
                  href={`/${locale}/admin/abuse-reports/${report.id}`}
                  className="text-brand-700 hover:underline"
                >
                  {t('admin.reports.openDetail')}
                </a>
              </td>
            </tr>
          ))}
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-2 text-gray-500">
                {t('admin.reports.empty')}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
