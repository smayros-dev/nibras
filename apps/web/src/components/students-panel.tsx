'use client';

import { grantFor } from '@nibras/contracts/web';
import type {
  GuardianInfo,
  MembershipStatus,
  StudentSummary,
  StudentsPage,
  WorkspaceDetail,
} from '@nibras/contracts';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Card,
  DropdownMenu,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SkeletonTable,
  Table,
  Tabs,
  useSubmit,
  useToast,
  type BadgeVariant,
} from '@nibras/ui';
import {
  Check,
  Flag,
  GraduationCap,
  Link2,
  MoreHorizontal,
  Plus,
  Send,
  Upload,
  UserMinus,
  UserRound,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { lazy, Suspense, useState } from 'react';
import { useRouter } from '../i18n/navigation';
import { api, asApiResult } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';
import { membershipStatusBadge } from '../lib/membership-status';
import { useAbortableQuery } from '../lib/paged-fetch';
import { useReturnFocus } from '../lib/use-return-focus';
import { InvitationsList, retryAfterMinutes, useOpenInvitations } from './invitations-list';
import { InviteLinkCard } from './invite-link-card';
import { InviteStudentDialog } from './invite-student-dialog';
import { ReportAbuseButton } from './report-abuse-button';

/**
 * Loaded on the first click of « Importer CSV »: the dialog (preview table, progress polling) is
 * kept out of the route's first-load JS (PRD §14.1 budget).
 */
const CsvImportDialog = lazy(() =>
  import('./csv-import-dialog').then((m) => ({ default: m.CsvImportDialog })),
);

export type StudentsTab = 'all' | 'pending';

/** Statuses listed under « En attente » (waiting on the teacher or on the guardian). */
const PENDING_STATUSES: readonly MembershipStatus[] = [
  'PENDING_APPROVAL',
  'PENDING_GUARDIAN_CONSENT',
  'SUSPENDED_NO_CONSENT',
  'SUSPENDED_CONSENT_REVOKED',
];

/** Statuses whose guardian request the teacher may send again (AC-INV-12). */
const CONSENT_STATUSES: readonly MembershipStatus[] = PENDING_STATUSES.filter(
  (s) => s !== 'PENDING_APPROVAL',
);

const GUARDIAN_BADGE: Record<GuardianInfo['status'], BadgeVariant> = {
  PENDING: 'warning',
  ACTIVE: 'success',
  REFUSED: 'danger',
  REVOKED: 'danger',
};

/** Course titles shown per row in « Cours »; the rest is « +n » (PRD §8.3). */
const MAX_COURSE_TITLES = 2;

const fullName = (s: Pick<StudentSummary, 'firstName' | 'lastName'>) =>
  `${s.firstName} ${s.lastName}`;

/**
 * The students page (PRD §9.1, §8.3; AC-INV-01/04/05/08 UI): « Mes étudiants ({n}) » with
 * **+ Inviter** (`InviteStudentDialog`), **Importer CSV** (`CsvImportDialog`, loaded on demand) and
 * **Lien de groupe**
 * (`InviteLinkCard`); tabs **Tous** (the active students) and **En attente** (students waiting on
 * approval or on their guardian, then the open email invitations — `InvitationsList`); the tab is
 * kept in `?tab=`. Both lists load through `useAbortableQuery` with the debounced search. Row menus
 * are named after the student and offer what the §7 matrix grants: **Profil**, **Approuver** /
 * **Refuser** (`PENDING_APPROVAL`, `student.invite`; an organisation TEACHER only for students he
 * invited), **Renvoyer au tuteur** (consent statuses, `student.update`; `429` → minutes left),
 * **Retirer** (`AlertDialog`, `student.remove`), **Signaler**. A SUSPENDED/DELETING workspace is
 * read-only (423): no write action. « Cours » shows up to two titles then « +n », « Progression »
 * the mean `progressPercent` (SP3); attendance and activity are SP5–SP6 (« — »).
 */
export function StudentsPanel({
  wid,
  detail,
  meId,
  initialTab = 'all',
}: {
  wid: string;
  detail: WorkspaceDetail;
  meId: string;
  initialTab?: StudentsTab;
}) {
  const t = useTranslations();
  const { toast } = useToast();
  const router = useRouter();
  const writable = detail.status === 'ACTIVE';
  const isOrg = detail.type === 'ORGANIZATION';
  const grant = { role: detail.myRole, canTeach: detail.myCanTeach, workspaceType: detail.type };
  const canInvite = writable && grantFor(grant, 'student.invite') !== 'none';
  const canUpdate = writable && grantFor(grant, 'student.update') !== 'none';
  const canRemove = writable && grantFor(grant, 'student.remove') !== 'none';
  /** Scope `own` of approve/reject: an organisation TEACHER decides on his own invitees only. */
  const ownApprovals = isOrg && detail.myRole === 'TEACHER';

  const [tab, setTab] = useState<StudentsTab>(initialTab);
  const [query, setQuery] = useState('');
  const q = query.trim();
  const [showLinks, setShowLinks] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  /** `null` until first opened: the dialog's chunk is fetched then, not with the page. */
  const [importOpen, setImportOpen] = useState<boolean | null>(null);
  const [removeTarget, setRemoveTarget] = useState<StudentSummary | null>(null);
  const [reportTarget, setReportTarget] = useState<StudentSummary | null>(null);
  const returnFocus = useReturnFocus();

  const students = useAbortableQuery([wid, q], async (signal) => {
    let result;
    try {
      result = asApiResult<StudentsPage>(
        await api.GET('/workspaces/{wid}/students', {
          params: { path: { wid }, query: { ...(q ? { q } : {}), limit: 100 } },
          signal,
        }),
      );
    } catch {
      throw new Error(t('errors.INTERNAL_ERROR'));
    }
    if (result.error) throw new Error(apiErrorMessage(t, result.error));
    return result.data?.items ?? [];
  });
  const invitations = useOpenInvitations(wid, 'STUDENT', q, t);

  const reloadAll = () => {
    students.reload();
    invitations.reload();
  };

  const changeTab = (value: string) => {
    const next: StudentsTab = value === 'pending' ? 'pending' : 'all';
    setTab(next);
    // Shareable without a server round trip (Next keeps `useSearchParams` in sync).
    const url = new URL(window.location.href);
    if (next === 'pending') url.searchParams.set('tab', 'pending');
    else url.searchParams.delete('tab');
    window.history.replaceState(window.history.state, '', url);
  };

  const mutate = useSubmit(
    async (
      call: () => Promise<Parameters<typeof asApiResult>[0]>,
      success: string,
    ): Promise<boolean> => {
      try {
        const { error } = asApiResult<unknown>(await call());
        if (error) {
          const min = retryAfterMinutes(error);
          toast({
            title: min !== null ? t('students.retryIn', { min }) : apiErrorMessage(t, error),
            variant: 'danger',
          });
          return false;
        }
      } catch {
        toast({ title: t('errors.INTERNAL_ERROR'), variant: 'danger' });
        return false;
      } finally {
        students.reload();
      }
      toast({ title: success, variant: 'success' });
      return true;
    },
  );

  const all = students.data;
  const active = all?.filter((s) => !PENDING_STATUSES.includes(s.status));
  const waiting = all?.filter((s) => PENDING_STATUSES.includes(s.status));
  const openInvitations = invitations.data;
  const count = (all?.length ?? 0) + (openInvitations?.length ?? 0);
  const loaded = all !== undefined && openInvitations !== undefined;
  const nothingYet = loaded && count === 0 && q === '';

  const inviteButton = (
    <Button
      variant="primary"
      onClick={(event) => {
        returnFocus.remember(event.currentTarget);
        setInviteOpen(true);
      }}
    >
      <Plus aria-hidden="true" className="size-4" />
      {t('students.invite')}
    </Button>
  );

  const columns = {
    name: t('students.name'),
    status: t('students.status'),
    courses: t('students.courses'),
    progress: t('students.progress'),
    attendance: t('students.attendance'),
    guardian: t('students.guardian'),
    lastActivity: t('students.lastActivity'),
  };

  const soon = (
    <span title={t('students.soon')} className="text-fg-muted">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{t('students.soon')}</span>
    </span>
  );

  const studentsTable = (rows: StudentSummary[], caption: string) => (
    <Table caption={caption} hideCaption>
      <Table.Head>
        <Table.Row>
          <Table.Th>{columns.name}</Table.Th>
          <Table.Th>{columns.status}</Table.Th>
          <Table.Th>{columns.courses}</Table.Th>
          <Table.Th>{columns.progress}</Table.Th>
          <Table.Th>{columns.attendance}</Table.Th>
          <Table.Th>{columns.guardian}</Table.Th>
          <Table.Th>{columns.lastActivity}</Table.Th>
          <Table.Th>
            <span className="sr-only">{t('students.actions')}</span>
          </Table.Th>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {rows.map((s) => {
          const name = fullName(s);
          const badge = membershipStatusBadge(s.status);
          const canDecide =
            canInvite &&
            s.status === 'PENDING_APPROVAL' &&
            (!ownApprovals || s.invitedByUserId === meId);
          const canResend = canUpdate && s.guardian !== null && CONSENT_STATUSES.includes(s.status);
          const path = { wid, uid: s.userId };
          return (
            <Table.Row key={s.userId} data-testid={`student-${s.userId}`}>
              <Table.Td label={columns.name}>
                <span className="block font-medium">{name}</span>
                {s.email ? (
                  <span className="block text-xs break-all text-fg-muted">{s.email}</span>
                ) : null}
              </Table.Td>
              <Table.Td label={columns.status}>
                <Badge variant={badge.variant}>{t(badge.labelKey)}</Badge>
              </Table.Td>
              <Table.Td label={columns.courses}>
                {s.courses.length > 0 ? (
                  <span className="flex flex-wrap items-center gap-1">
                    {s.courses.slice(0, MAX_COURSE_TITLES).map((c) => (
                      <Badge key={c.courseId} variant="neutral">
                        {c.title}
                      </Badge>
                    ))}
                    {s.courses.length > MAX_COURSE_TITLES ? (
                      <span
                        className="text-xs text-fg-muted"
                        title={s.courses
                          .slice(MAX_COURSE_TITLES)
                          .map((c) => c.title)
                          .join(', ')}
                      >
                        <span aria-hidden="true">{`+${s.courses.length - MAX_COURSE_TITLES}`}</span>
                        <span className="sr-only">
                          {t('enrollments.moreCourses', {
                            count: s.courses.length - MAX_COURSE_TITLES,
                          })}
                        </span>
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span aria-hidden="true">—</span>
                )}
              </Table.Td>
              <Table.Td label={columns.progress}>
                {s.progressPercent !== null ? (
                  <span className="tabular-nums">
                    {t('enrollments.percent', { percent: s.progressPercent })}
                  </span>
                ) : (
                  <span aria-hidden="true">—</span>
                )}
              </Table.Td>
              <Table.Td label={columns.attendance}>{soon}</Table.Td>
              <Table.Td label={columns.guardian}>
                {s.guardian ? (
                  <span className="flex flex-col items-start gap-1">
                    <Badge variant={GUARDIAN_BADGE[s.guardian.status]}>
                      {t(`guardian.status_${s.guardian.status}`)}
                    </Badge>
                    <span className="text-xs break-all text-fg-muted">
                      {s.guardian.email ?? s.guardian.emailMasked}
                    </span>
                  </span>
                ) : (
                  <span aria-hidden="true">—</span>
                )}
              </Table.Td>
              <Table.Td label={columns.lastActivity}>{soon}</Table.Td>
              <Table.Actions>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('students.rowActions', { name })}
                      ref={returnFocus.register(s.userId)}
                    >
                      <MoreHorizontal aria-hidden="true" className="size-5" />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end">
                    <DropdownMenu.Item
                      icon={<UserRound />}
                      onSelect={() => router.push(`/app/w/${wid}/students/${s.userId}`)}
                    >
                      {t('students.openProfile')}
                    </DropdownMenu.Item>
                    {canDecide ? (
                      <>
                        <DropdownMenu.Item
                          icon={<Check />}
                          disabled={mutate.busy}
                          onSelect={() =>
                            void mutate.submit(
                              () =>
                                api.POST('/workspaces/{wid}/members/{uid}/approve', {
                                  params: { path },
                                }),
                              t('students.approved', { name }),
                            )
                          }
                        >
                          {t('students.approve')}
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          icon={<X />}
                          disabled={mutate.busy}
                          onSelect={() =>
                            void mutate.submit(
                              () =>
                                api.POST('/workspaces/{wid}/members/{uid}/reject', {
                                  params: { path },
                                }),
                              t('students.rejected', { name }),
                            )
                          }
                        >
                          {t('students.reject')}
                        </DropdownMenu.Item>
                      </>
                    ) : null}
                    {canResend ? (
                      <DropdownMenu.Item
                        icon={<Send />}
                        disabled={mutate.busy}
                        onSelect={() =>
                          void mutate.submit(
                            () =>
                              api.POST('/workspaces/{wid}/students/{uid}/guardian/resend-consent', {
                                params: { path },
                              }),
                            t('students.consentResent'),
                          )
                        }
                      >
                        {t('students.resendConsent')}
                      </DropdownMenu.Item>
                    ) : null}
                    <DropdownMenu.Separator />
                    {canRemove ? (
                      <DropdownMenu.Item
                        destructive
                        icon={<UserMinus />}
                        onSelect={() => {
                          returnFocus.remember(s.userId);
                          setRemoveTarget(s);
                        }}
                      >
                        {t('students.remove')}
                      </DropdownMenu.Item>
                    ) : null}
                    <DropdownMenu.Item
                      icon={<Flag />}
                      onSelect={() => {
                        returnFocus.remember(s.userId);
                        setReportTarget(s);
                      }}
                    >
                      {t('abuse.report')}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </Table.Actions>
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table>
  );

  const listError = students.error ?? invitations.error;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        as="h2"
        title={t('students.title', { count })}
        actions={
          writable ? (
            <div className="flex flex-wrap gap-2">
              {canInvite ? inviteButton : null}
              {canInvite ? (
                <Button
                  variant="secondary"
                  onClick={(event) => {
                    returnFocus.remember(event.currentTarget);
                    setImportOpen(true);
                  }}
                >
                  <Upload aria-hidden="true" className="size-4" />
                  {t('students.importCsv')}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                aria-expanded={showLinks}
                aria-controls="students-invite-links"
                onClick={() => setShowLinks((open) => !open)}
              >
                <Link2 aria-hidden="true" className="size-4" />
                {t('students.groupLink')}
              </Button>
            </div>
          ) : null
        }
      />

      <div id="students-invite-links" hidden={!showLinks}>
        {showLinks ? <InviteLinkCard wid={wid} isOrg={isOrg} canManage={canInvite} /> : null}
      </div>

      {nothingYet ? (
        <Card>
          <EmptyState
            as="h3"
            icon={<GraduationCap />}
            title={t('students.emptyTitle')}
            description={t('students.emptyDescription')}
            action={canInvite ? inviteButton : undefined}
          />
        </Card>
      ) : (
        <Tabs.Root value={tab} onValueChange={changeTab}>
          <Tabs.List aria-label={t('students.tabs')}>
            <Tabs.Trigger value="all">{t('students.tabAll')}</Tabs.Trigger>
            <Tabs.Trigger value="pending">{t('students.tabPending')}</Tabs.Trigger>
          </Tabs.List>

          <div className="max-w-md">
            <Field htmlFor="students-q" label={t('students.search')}>
              <Input
                id="students-q"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </Field>
          </div>

          {listError ? <Alert variant="danger">{listError}</Alert> : null}

          <Tabs.Content value="all">
            <Card padding="none" aria-busy={students.loading}>
              {active === undefined ? (
                students.error ? null : (
                  <SkeletonTable className="p-4" cols={6} />
                )
              ) : active.length === 0 ? (
                <EmptyState as="h3" icon={<GraduationCap />} title={t('students.noMatch')} />
              ) : (
                studentsTable(active, t('students.tabAll'))
              )}
            </Card>
          </Tabs.Content>

          <Tabs.Content value="pending" className="flex flex-col gap-6">
            {waiting === undefined || openInvitations === undefined ? (
              listError ? null : (
                <Card padding="none" aria-busy="true">
                  <SkeletonTable className="p-4" cols={6} />
                </Card>
              )
            ) : waiting.length === 0 && openInvitations.length === 0 ? (
              <Card>
                <EmptyState as="h3" icon={<GraduationCap />} title={t('students.noPending')} />
              </Card>
            ) : (
              <>
                {waiting.length > 0 ? (
                  <section aria-labelledby="students-requests" className="flex flex-col gap-3">
                    <h3 id="students-requests" className="font-semibold text-fg">
                      {t('students.requests')}
                    </h3>
                    <Card padding="none" aria-busy={students.loading}>
                      {studentsTable(waiting, t('students.requests'))}
                    </Card>
                  </section>
                ) : null}
                {openInvitations.length > 0 ? (
                  <section aria-labelledby="students-invitations" className="flex flex-col gap-3">
                    <h3 id="students-invitations" className="font-semibold text-fg">
                      {t('invitations.title')}
                    </h3>
                    <Card padding="none" aria-busy={invitations.loading}>
                      <InvitationsList
                        wid={wid}
                        items={openInvitations}
                        canManage={canInvite}
                        onChanged={invitations.reload}
                        caption={t('invitations.title')}
                      />
                    </Card>
                  </section>
                ) : null}
              </>
            )}
          </Tabs.Content>
        </Tabs.Root>
      )}

      {canInvite ? (
        <InviteStudentDialog
          wid={wid}
          detail={detail}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          onInvited={reloadAll}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        />
      ) : null}

      {canInvite && importOpen !== null ? (
        <Suspense fallback={null}>
          <CsvImportDialog
            wid={wid}
            open={importOpen}
            onOpenChange={setImportOpen}
            onDone={reloadAll}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          />
        </Suspense>
      ) : null}

      <AlertDialog.Root
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        {removeTarget ? (
          <AlertDialog.Content
            title={t('students.removeTitle', { name: fullName(removeTarget) })}
            description={t('students.removeDescription')}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          >
            <AlertDialog.Footer>
              <AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>
              <AlertDialog.Action
                destructive
                loading={mutate.busy}
                onClick={(event) => {
                  // Stay open while the request runs; close on the outcome (error → toast).
                  event.preventDefault();
                  const target = removeTarget;
                  void mutate
                    .submit(
                      () =>
                        api.DELETE('/workspaces/{wid}/members/{uid}', {
                          params: { path: { wid, uid: target.userId } },
                        }),
                      t('students.removed'),
                    )
                    .finally(() => setRemoveTarget(null));
                }}
              >
                {t('students.removeConfirm', { name: fullName(removeTarget) })}
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        ) : null}
      </AlertDialog.Root>

      {reportTarget ? (
        <ReportAbuseButton
          key={reportTarget.userId}
          workspaceId={writable ? wid : null}
          entityType="USER"
          entityId={reportTarget.userId}
          open
          onOpenChange={(open) => {
            if (open) return;
            setReportTarget(null);
            returnFocus.focusOpener();
          }}
        />
      ) : null}
    </div>
  );
}
