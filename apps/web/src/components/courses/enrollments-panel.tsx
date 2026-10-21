'use client';

import type { CourseDetail, EnrollmentSummary, EnrollmentsPage } from '@nibras/contracts';
import { formatDate } from '@nibras/i18n';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SkeletonTable,
  Table,
  useSubmit,
  useToast,
} from '@nibras/ui';
import { GraduationCap, Plus, UserMinus } from 'lucide-react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, asApiResult } from '../../lib/api';
import { apiErrorMessage } from '../../lib/api-error';
import { useAbortableQuery } from '../../lib/paged-fetch';
import { useReturnFocus } from '../../lib/use-return-focus';
import { AssignStudentsDialog } from './assign-students-dialog';
import { ENROLLMENT_STATUS_LABEL } from './enrollment-status';
import { ProgressBar } from './progress-bar';

const fullName = (e: Pick<EnrollmentSummary, 'firstName' | 'lastName'>) =>
  `${e.firstName} ${e.lastName}`;

/**
 * The course's « Étudiants » tab (PRD §8.5.1, §10.8; AC-ENR-01/03 UI): the enrolled students
 * (`GET …/enrollments`, 100 per page with « Afficher plus ») with status, progress and assignment
 * date; « Retirer » confirms in an `AlertDialog` then `DELETE …/enrollments/{uid}` (progress kept);
 * « Attribuer » opens `AssignStudentsDialog` (mounted on the first click). An ARCHIVED course
 * takes no new assignment; a read-only workspace (SUSPENDED/DELETING) offers no write action. The
 * caller reached the course page, so he holds `enrollment.manage` on it (OWNER/ADMIN all, TEACHER
 * own).
 *
 * Budget note (PRD §14.1): this panel and its dialog are imported statically (≈ 3.5 kB gzip on the
 * course page). Any new React.lazy split here or in the student profile made Turbopack re-partition
 * the shared app chunks (api, api-error, i18n navigation, permissions duplicated into one more
 * chunk), adding ≈ 12 kB to every workspace route and pushing students/members over 250 kB.
 */
export function EnrollmentsPanel({
  wid,
  course,
  writable,
  onChanged,
}: {
  wid: string;
  course: CourseDetail;
  writable: boolean;
  /** After an assignment or a revocation (the course's `enrolledCount` changed). */
  onChanged?: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const timeZone = useTimeZone() ?? 'UTC';
  const { toast } = useToast();
  const returnFocus = useReturnFocus();
  const cid = course.id;
  const canAssign = writable && course.status !== 'ARCHIVED';

  /** `null` until first opened: the dialog (and its student query) mounts then. */
  const [assignOpen, setAssignOpen] = useState<boolean | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<EnrollmentSummary | null>(null);
  const [more, setMore] = useState<{ items: EnrollmentSummary[]; nextCursor: string | null }>({
    items: [],
    nextCursor: null,
  });

  const fetchPage = async (cursor: string | undefined, signal?: AbortSignal) => {
    const result = asApiResult<EnrollmentsPage>(
      await api.GET('/workspaces/{wid}/courses/{cid}/enrollments', {
        params: { path: { wid, cid }, query: { limit: 100, ...(cursor ? { cursor } : {}) } },
        signal,
      }),
    );
    if (result.error || !result.data) throw new Error(apiErrorMessage(t, result.error ?? null));
    return result.data;
  };

  const first = useAbortableQuery(
    [wid, cid],
    async (signal) => {
      try {
        const page = await fetchPage(undefined, signal);
        setMore({ items: [], nextCursor: page.nextCursor });
        return page.items;
      } catch (error) {
        throw error instanceof Error ? error : new Error(t('errors.INTERNAL_ERROR'));
      }
    },
    { debounceMs: 0 },
  );

  const loadMore = useSubmit(async () => {
    if (!more.nextCursor) return;
    try {
      const page = await fetchPage(more.nextCursor);
      setMore((m) => ({ items: [...m.items, ...page.items], nextCursor: page.nextCursor }));
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : t('errors.INTERNAL_ERROR'),
        variant: 'danger',
      });
    }
  });

  const changed = () => {
    first.reload();
    onChanged?.();
  };

  const revoke = useSubmit(async (target: EnrollmentSummary) => {
    try {
      const { error } = asApiResult<unknown>(
        await api.DELETE('/workspaces/{wid}/courses/{cid}/enrollments/{uid}', {
          params: { path: { wid, cid, uid: target.studentUserId } },
          body: {},
        }),
      );
      if (error) {
        toast({ title: apiErrorMessage(t, error), variant: 'danger' });
        return;
      }
    } catch {
      toast({ title: t('errors.INTERNAL_ERROR'), variant: 'danger' });
      return;
    }
    toast({ title: t('enrollments.revoked'), variant: 'success' });
    changed();
  });

  const rows = first.data ? [...first.data, ...more.items] : undefined;
  const activeIds = (rows ?? []).filter((r) => r.status === 'ACTIVE').map((r) => r.studentUserId);

  const assignButton = canAssign ? (
    <Button
      variant="primary"
      onClick={(event) => {
        returnFocus.remember(event.currentTarget);
        setAssignOpen(true);
      }}
    >
      <Plus aria-hidden="true" className="size-4" />
      {t('enrollments.assign')}
    </Button>
  ) : null;

  const columns = {
    name: t('enrollments.colName'),
    status: t('enrollments.colStatus'),
    progress: t('enrollments.colProgress'),
    assignedAt: t('enrollments.colAssignedAt'),
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        as="h2"
        title={t('enrollments.title')}
        actions={rows && rows.length > 0 ? assignButton : null}
      />
      {writable && course.status === 'ARCHIVED' ? (
        <Alert variant="info">{t('enrollments.archivedNoAssign')}</Alert>
      ) : null}
      {first.error ? <Alert variant="danger">{first.error}</Alert> : null}

      {rows === undefined ? (
        first.error ? null : (
          <Card padding="none" aria-busy="true">
            <SkeletonTable className="p-4" cols={4} />
          </Card>
        )
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            as="h3"
            icon={<GraduationCap />}
            title={t('enrollments.emptyTitle')}
            description={t('enrollments.emptyDescription')}
            action={assignButton ?? undefined}
          />
        </Card>
      ) : (
        <Card padding="none" aria-busy={first.loading}>
          <Table caption={t('enrollments.title')} hideCaption>
            <Table.Head>
              <Table.Row>
                <Table.Th>{columns.name}</Table.Th>
                <Table.Th>{columns.status}</Table.Th>
                <Table.Th>{columns.progress}</Table.Th>
                <Table.Th>{columns.assignedAt}</Table.Th>
                <Table.Th>
                  <span className="sr-only">{t('enrollments.colActions')}</span>
                </Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {rows.map((e) => {
                const name = fullName(e);
                return (
                  <Table.Row key={e.studentUserId} data-testid={`enrollment-${e.studentUserId}`}>
                    <Table.Td label={columns.name}>
                      <span className="font-medium">{name}</span>
                    </Table.Td>
                    <Table.Td label={columns.status}>
                      <Badge variant={e.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {t(ENROLLMENT_STATUS_LABEL[e.status])}
                      </Badge>
                    </Table.Td>
                    <Table.Td label={columns.progress}>
                      <ProgressBar
                        percent={e.progressPercent}
                        label={t('enrollments.progressOf', { name })}
                      />
                    </Table.Td>
                    <Table.Td label={columns.assignedAt}>
                      {formatDate(new Date(e.activatedAt), locale, timeZone, {
                        dateStyle: 'medium',
                      })}
                    </Table.Td>
                    <Table.Actions>
                      {writable && e.status === 'ACTIVE' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('enrollments.revokeConfirm', { name })}
                          ref={returnFocus.register(e.studentUserId)}
                          onClick={() => {
                            returnFocus.remember(e.studentUserId);
                            setRevokeTarget(e);
                          }}
                        >
                          <UserMinus aria-hidden="true" className="size-4" />
                          <span aria-hidden="true">{t('students.remove')}</span>
                        </Button>
                      ) : null}
                    </Table.Actions>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        </Card>
      )}

      {more.nextCursor && first.current ? (
        <div>
          <Button
            variant="secondary"
            loading={loadMore.busy}
            onClick={() => void loadMore.submit()}
          >
            {t('enrollments.loadMore')}
          </Button>
        </div>
      ) : null}

      {canAssign && assignOpen !== null ? (
        <AssignStudentsDialog
          wid={wid}
          courseId={cid}
          courseTitle={course.title}
          enrolledIds={activeIds}
          open={assignOpen}
          onOpenChange={setAssignOpen}
          onAssigned={changed}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        />
      ) : null}

      <AlertDialog.Root
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        {revokeTarget ? (
          <AlertDialog.Content
            title={t('enrollments.revokeTitle', {
              name: fullName(revokeTarget),
              title: course.title,
            })}
            description={t('enrollments.revokeDescription')}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          >
            <AlertDialog.Footer>
              <AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>
              <AlertDialog.Action
                destructive
                loading={revoke.busy}
                onClick={(event) => {
                  // Stay open while the request runs; close on the outcome (error → toast).
                  event.preventDefault();
                  const target = revokeTarget;
                  void revoke.submit(target).finally(() => setRevokeTarget(null));
                }}
              >
                {t('enrollments.revokeConfirm', { name: fullName(revokeTarget) })}
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        ) : null}
      </AlertDialog.Root>
    </div>
  );
}
