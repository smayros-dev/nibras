'use client';

import { ABUSE_REPORT_STATUSES } from '@nibras/contracts/web';
import type { AbuseReportStatus, AdminAbuseReport } from '@nibras/contracts';
import { formatDate } from '@nibras/i18n';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Card,
  Field,
  Select,
  SkeletonText,
  Textarea,
  useSubmit,
  useToast,
} from '@nibras/ui';
import { ArrowLeft } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { AdminReasonDialog } from './admin-reason-dialog';
import { Link } from '../i18n/navigation';
import { abuseStatusBadge } from '../lib/abuse-status';
import { apiErrorMessage, issuesToFieldErrors } from '../lib/api-error';
import { api, asApiResult } from '../lib/api';
import { useAbortableQuery } from '../lib/paged-fetch';
import { useErrorFocus } from '../lib/use-error-focus';

interface UserSnapshot {
  membership?: { role?: string } | null;
}

/** Roles whose holder can be suspended from a report (a teaching membership, US-X03). */
const TEACHING_ROLES = ['TEACHER', 'ADMIN', 'OWNER'];

/**
 * Super-admin abuse-report detail (US-X03): the report and its frozen snapshot, the status /
 * resolution form, and — when the target is a USER with a teaching membership — suspending
 * (reason in a dialog) or reactivating (confirmed) the reported account. Outcomes are toasts.
 */
export function AdminAbuseReportDetail({ id }: { id: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const { toast } = useToast();

  const report = useAbortableQuery(
    [id],
    async (signal): Promise<AdminAbuseReport> => {
      let result;
      try {
        result = asApiResult<AdminAbuseReport>(
          await api.GET('/admin/abuse-reports/{id}', { params: { path: { id } }, signal }),
        );
      } catch {
        throw new Error(t('errors.INTERNAL_ERROR'));
      }
      if (result.error || !result.data) throw new Error(apiErrorMessage(t, result.error));
      return result.data;
    },
    { debounceMs: 0 },
  );
  const data = report.data;

  const [newStatus, setNewStatus] = useState<AbuseReportStatus | ''>('');
  const [resolution, setResolution] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, alertRef } = useErrorFocus(fieldErrors, formError);

  // The form starts from the stored resolution each time the report (re)loads.
  useEffect(() => {
    if (data) setResolution(data.resolution ?? '');
  }, [data]);

  // Resolved after mount: the server has no viewer time zone (no hydration mismatch).
  const [viewerTimezone, setViewerTimezone] = useState('UTC');
  useEffect(() => {
    setViewerTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  const save = useSubmit(async () => {
    setFieldErrors(undefined);
    setFormError(null);
    const trimmed = resolution.trim();
    try {
      const { error } = asApiResult<unknown>(
        await api.PATCH('/admin/abuse-reports/{id}', {
          params: { path: { id } },
          body: {
            ...(newStatus ? { status: newStatus } : {}),
            resolution: trimmed === '' ? null : trimmed,
          },
        }),
      );
      if (error) {
        const mapped = issuesToFieldErrors(t, error);
        if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
        else setFormError(apiErrorMessage(t, error));
        return;
      }
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    setNewStatus('');
    toast({ title: t('admin.reports.saved'), variant: 'success' });
    report.reload();
  });

  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const reactivate = useSubmit(async (uid: string) => {
    try {
      const { error } = asApiResult<unknown>(
        await api.POST('/admin/users/{uid}/unsuspend', { params: { path: { uid } } }),
      );
      if (error) {
        toast({ title: apiErrorMessage(t, error), variant: 'danger' });
        return;
      }
    } catch {
      toast({ title: t('errors.INTERNAL_ERROR'), variant: 'danger' });
      return;
    } finally {
      setReactivateOpen(false);
    }
    toast({ title: t('admin.reports.userReactivated'), variant: 'success' });
  });

  const back = (
    <Link
      href="/admin/abuse-reports"
      className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-primary hover:underline"
    >
      <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
      {t('admin.reports.backToQueue')}
    </Link>
  );

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        {report.error ? (
          <Alert variant="danger">{report.error}</Alert>
        ) : (
          <Card aria-busy="true">
            <SkeletonText lines={5} />
          </Card>
        )}
      </div>
    );
  }

  const snapshot = data.contextSnapshot as UserSnapshot;
  const canSuspendUser =
    data.entityType === 'USER' && TEACHING_ROLES.includes(snapshot.membership?.role ?? '');
  const unchanged = !newStatus && resolution === (data.resolution ?? '');

  const detail = (label: string, value: ReactNode) => (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="text-sm text-fg">{value}</dd>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {back}
      {report.error ? <Alert variant="danger">{report.error}</Alert> : null}

      <Card aria-labelledby="abuse-details-title">
        <Card.Header>
          <Card.Title id="abuse-details-title">{t('admin.reports.details')}</Card.Title>
        </Card.Header>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {detail(
            t('admin.reports.filterCategory'),
            <Badge variant={data.category === 'MINOR_SAFETY' ? 'danger' : 'neutral'}>
              {t(`abuse.category_${data.category}`)}
            </Badge>,
          )}
          {detail(
            t('admin.reports.filterStatus'),
            <Badge variant={abuseStatusBadge(data.status)} data-testid="admin-abuse-status">
              {t(`abuse.status_${data.status}`)}
            </Badge>,
          )}
          {detail(
            t('admin.reports.targetType'),
            <span dir="ltr" className="font-mono">
              {data.entityType}
            </span>,
          )}
          {detail(
            t('admin.reports.reporter'),
            `${data.reporter.firstName} ${data.reporter.lastName}`,
          )}
          {detail(
            t('admin.reports.createdAt'),
            formatDate(new Date(data.createdAt), locale, viewerTimezone),
          )}
        </dl>
      </Card>

      <Card aria-labelledby="abuse-description-title">
        <Card.Header>
          <Card.Title id="abuse-description-title">{t('admin.reports.description')}</Card.Title>
        </Card.Header>
        <p className="text-sm whitespace-pre-wrap text-fg">{data.description}</p>
      </Card>

      <Card aria-labelledby="abuse-snapshot-title">
        <Card.Header>
          <Card.Title id="abuse-snapshot-title">{t('admin.reports.snapshot')}</Card.Title>
        </Card.Header>
        <pre
          dir="ltr"
          data-testid="admin-abuse-snapshot"
          className="overflow-auto rounded-sm bg-bg-subtle p-3 font-mono text-xs text-fg"
        >
          {JSON.stringify(data.contextSnapshot, null, 2)}
        </pre>
      </Card>

      <Card aria-labelledby="abuse-handling-title">
        <Card.Header>
          <Card.Title id="abuse-handling-title">{t('admin.reports.handling')}</Card.Title>
        </Card.Header>
        <form
          method="post"
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save.submit();
          }}
          className="flex max-w-xl flex-col gap-4"
        >
          {formError ? (
            <Alert ref={alertRef} tabIndex={-1} variant="danger">
              {formError}
            </Alert>
          ) : null}
          <Field
            htmlFor="admin-abuse-new-status"
            label={t('admin.reports.newStatus')}
            error={fieldErrors?.status}
          >
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
          <Field
            htmlFor="admin-abuse-resolution"
            label={t('admin.reports.resolution')}
            error={fieldErrors?.resolution}
          >
            <Textarea
              id="admin-abuse-resolution"
              rows={3}
              value={resolution}
              placeholder={t('admin.reports.resolutionPlaceholder')}
              onChange={(e) => setResolution(e.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" variant="primary" loading={save.busy} disabled={unchanged}>
              {t('admin.reports.save')}
            </Button>
          </div>
        </form>
      </Card>

      {canSuspendUser ? (
        <Card aria-labelledby="abuse-account-title">
          <Card.Header>
            <Card.Title id="abuse-account-title">{t('admin.reports.userAccount')}</Card.Title>
          </Card.Header>
          <div className="flex flex-wrap gap-2">
            <AdminReasonDialog
              open={suspendOpen}
              onOpenChange={setSuspendOpen}
              trigger={<Button variant="danger">{t('admin.reports.suspendTeacher')}</Button>}
              title={t('admin.reports.confirmSuspendUser')}
              description={t('admin.reports.suspendUserDescription')}
              submitLabel={t('admin.reports.suspendUser')}
              onConfirm={async (reason) => {
                const { error } = asApiResult<unknown>(
                  await api.POST('/admin/users/{uid}/suspend', {
                    params: { path: { uid: data.entityId } },
                    body: { reason },
                  }),
                );
                if (error) return error;
                toast({ title: t('admin.reports.userSuspended'), variant: 'success' });
                return null;
              }}
            />
            <AlertDialog.Root open={reactivateOpen} onOpenChange={setReactivateOpen}>
              <AlertDialog.Trigger asChild>
                <Button variant="secondary">{t('admin.reports.reactivateUser')}</Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content
                title={t('admin.reports.confirmReactivateUser')}
                description={t('admin.reports.reactivateUserDescription')}
              >
                <AlertDialog.Footer>
                  <AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>
                  <AlertDialog.Action
                    loading={reactivate.busy}
                    onClick={(event) => {
                      // Stay open while the request runs; close on the outcome (error → toast).
                      event.preventDefault();
                      void reactivate.submit(data.entityId);
                    }}
                  >
                    {t('admin.reports.reactivateUser')}
                  </AlertDialog.Action>
                </AlertDialog.Footer>
              </AlertDialog.Content>
            </AlertDialog.Root>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
