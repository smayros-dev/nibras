'use client';

import {
  ABUSE_CATEGORIES,
  ABUSE_REPORT_STATUSES,
  type AbuseCategory,
  type AbuseReportsPage,
  type AbuseReportStatus,
} from '@tt/contracts';
import { formatDate } from '@tt/i18n';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  SkeletonTable,
  Table,
  cn,
} from '@tt/ui';
import { ShieldAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '../i18n/navigation';
import { abuseStatusBadge } from '../lib/abuse-status';
import { api, asApiResult } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';
import { useAbortableQuery } from '../lib/paged-fetch';

/**
 * Super-admin abuse queue (US-X03): filters (status, category, workspace id) debounced and
 * abortable; MINOR_SAFETY reports pinned first and highlighted (AC-SAFE-05). Each row links to
 * the report's detail page.
 */
export function AdminAbuseReportsPanel() {
  const t = useTranslations();
  const locale = useLocale();

  const [reportStatus, setReportStatus] = useState<'' | AbuseReportStatus>('');
  const [category, setCategory] = useState<'' | AbuseCategory>('');
  const [workspaceId, setWorkspaceId] = useState('');
  const wsFilter = workspaceId.trim();

  const reports = useAbortableQuery([reportStatus, category, wsFilter], async (signal) => {
    let result;
    try {
      result = asApiResult<AbuseReportsPage>(
        await api.GET('/admin/abuse-reports', {
          params: {
            query: {
              ...(reportStatus ? { status: reportStatus } : {}),
              ...(category ? { category } : {}),
              ...(wsFilter ? { workspaceId: wsFilter } : {}),
              limit: 50,
            },
          },
          signal,
        }),
      );
    } catch {
      throw new Error(t('errors.INTERNAL_ERROR'));
    }
    if (result.error) throw new Error(apiErrorMessage(t, result.error));
    // Pin MINOR_SAFETY first (server order is newest first; stable sort keeps it within groups).
    return [...(result.data?.items ?? [])].sort(
      (a, b) => (a.category === 'MINOR_SAFETY' ? 0 : 1) - (b.category === 'MINOR_SAFETY' ? 0 : 1),
    );
  });

  // Resolved after mount: the server has no viewer time zone (no hydration mismatch).
  const [viewerTimezone, setViewerTimezone] = useState('UTC');
  useEffect(() => {
    setViewerTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  const columns = {
    category: t('admin.reports.filterCategory'),
    status: t('admin.reports.filterStatus'),
    target: t('admin.reports.targetType'),
    reporter: t('admin.reports.reporter'),
    createdAt: t('admin.reports.createdAt'),
  };

  const list = reports.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-fg">{t('admin.navAbuseReports')}</h2>
        <p className="text-sm text-fg-muted">{t('admin.reports.minorFirst')}</p>
      </div>

      <div
        role="group"
        aria-label={t('admin.reports.filters')}
        className="grid gap-3 sm:grid-cols-3"
      >
        <Field htmlFor="admin-abuse-status" label={t('admin.reports.filterStatus')}>
          <Select
            id="admin-abuse-status"
            value={reportStatus}
            onChange={(e) => setReportStatus(e.target.value as '' | AbuseReportStatus)}
          >
            <option value="">{t('admin.reports.allStatuses')}</option>
            {ABUSE_REPORT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`abuse.status_${value}`)}
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
            <option value="">{t('admin.reports.allCategories')}</option>
            {ABUSE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`abuse.category_${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="admin-abuse-workspace" label={t('admin.reports.filterWorkspace')}>
          <Input
            id="admin-abuse-workspace"
            type="search"
            dir="ltr"
            spellCheck={false}
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
          />
        </Field>
      </div>

      {reports.error ? <Alert variant="danger">{reports.error}</Alert> : null}

      <Card padding="none" aria-busy={reports.loading}>
        {list === undefined ? (
          reports.error ? null : (
            <SkeletonTable className="p-4" cols={5} />
          )
        ) : list.length === 0 ? (
          <EmptyState as="h3" icon={<ShieldAlert />} title={t('admin.reports.empty')} />
        ) : (
          <Table caption={t('admin.navAbuseReports')} hideCaption>
            <Table.Head>
              <Table.Row>
                <Table.Th>{columns.category}</Table.Th>
                <Table.Th>{columns.status}</Table.Th>
                <Table.Th>{columns.target}</Table.Th>
                <Table.Th>{columns.reporter}</Table.Th>
                <Table.Th>{columns.createdAt}</Table.Th>
                <Table.Th>
                  <span className="sr-only">{t('members.actions')}</span>
                </Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {list.map((report) => {
                const minor = report.category === 'MINOR_SAFETY';
                const reporter = `${report.reporter.firstName} ${report.reporter.lastName}`;
                return (
                  <Table.Row
                    key={report.id}
                    data-testid={`admin-abuse-${report.id}`}
                    data-minor-safety={minor ? 'true' : undefined}
                    className={cn(minor && 'bg-warning-subtle')}
                  >
                    <Table.Td label={columns.category}>
                      <Badge variant={minor ? 'danger' : 'neutral'}>
                        {t(`abuse.category_${report.category}`)}
                      </Badge>
                    </Table.Td>
                    <Table.Td label={columns.status}>
                      <Badge variant={abuseStatusBadge(report.status)}>
                        {t(`abuse.status_${report.status}`)}
                      </Badge>
                    </Table.Td>
                    <Table.Td label={columns.target}>
                      <span dir="ltr" className="font-mono text-xs">
                        {report.entityType}
                      </span>
                    </Table.Td>
                    <Table.Td label={columns.reporter}>{reporter}</Table.Td>
                    <Table.Td label={columns.createdAt}>
                      {formatDate(new Date(report.createdAt), locale, viewerTimezone, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </Table.Td>
                    <Table.Actions>
                      <Link
                        href={`/admin/abuse-reports/${report.id}`}
                        aria-label={t('admin.reports.openDetailFor', { name: reporter })}
                        className="inline-flex min-h-11 items-center font-medium text-primary hover:underline"
                      >
                        {t('admin.reports.openDetail')}
                      </Link>
                    </Table.Actions>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        )}
      </Card>
    </div>
  );
}
