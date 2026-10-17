'use client';

import { grantFor, MEMBERSHIP_ROLES, MEMBERSHIP_STATUSES } from '@tt/contracts/web';
import type {
  Assignment,
  AssignmentsPage,
  MemberSummary,
  MembersPage,
  MembershipRole,
  MembershipStatus,
  WorkspaceDetail,
} from '@tt/contracts';
import { formatDate } from '@tt/i18n';
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
  Select,
  SkeletonTable,
  Table,
  useSubmit,
  useToast,
  type BadgeVariant,
} from '@tt/ui';
import { Flag, MoreHorizontal, UserMinus, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ReportAbuseButton } from './report-abuse-button';
import { apiErrorMessage } from '../lib/api-error';
import { api, asApiResult } from '../lib/api';
import { useAbortableQuery } from '../lib/paged-fetch';
import { useReturnFocus } from '../lib/use-return-focus';

/** The API changes a role only between these two (else `422 ROLE_CHANGE_NOT_ALLOWED`). */
const STAFF_ROLES = ['ADMIN', 'TEACHER'] as const;

const ROLE_BADGE: Record<MembershipRole, BadgeVariant> = {
  OWNER: 'brand',
  ADMIN: 'info',
  TEACHER: 'neutral',
  ASSISTANT: 'neutral',
  STUDENT: 'neutral',
  GUARDIAN: 'neutral',
};

function statusBadge(status: MembershipStatus): BadgeVariant {
  if (status === 'ACTIVE') return 'success';
  if (status.startsWith('PENDING')) return 'warning';
  if (status.startsWith('SUSPENDED')) return 'danger';
  return 'neutral';
}

const fullName = (m: Pick<MemberSummary, 'firstName' | 'lastName'>) =>
  `${m.firstName} ${m.lastName}`;

/** `…` + the last 6 characters: an id no loaded member resolves (full id in `title`). */
const shortId = (id: string) => `…${id.slice(-6)}`;

/** Members a removal of whom is `student.remove`; any other role is `workspace.staff.manage`. */
const STUDENT_SIDE_ROLES: readonly MembershipRole[] = ['STUDENT', 'GUARDIAN'];

/**
 * Workspace members (PRD §9.2/§11.1). Actions come from the §7 matrix (`grantFor` with the
 * viewer's role, `can_teach` and the workspace type) and render only when allowed, in one menu per
 * row named after the member: role ADMIN↔TEACHER and *Peut enseigner* (`workspace.staff.manage`),
 * *Retirer* behind an `AlertDialog` (`student.remove` for a STUDENT/GUARDIAN, else
 * `workspace.staff.manage`), never on the OWNER or yourself; *Signaler* for everyone. A
 * SUSPENDED/DELETING workspace refuses every write (423): no write action is offered there, and
 * reports go to the account-level queue instead of the workspace's. The API stays the authority
 * (403 → toast). Filters are debounced and abortable (`useAbortableQuery`). For an ORGANIZATION,
 * the teacher ↔ student assignments are listed by name (PRD §11.2); students join by invitation
 * in SP2, so the list is empty in SP1.
 */
export function MembersPanel({
  wid,
  detail,
  meId,
}: {
  wid: string;
  detail: WorkspaceDetail;
  /** The viewer's user id (no action on your own row). */
  meId: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { toast } = useToast();
  const isOrg = detail.type === 'ORGANIZATION';
  /** AC-WS-06: a SUSPENDED/DELETING workspace is read-only (the API answers 423). */
  const writable = detail.status === 'ACTIVE';
  const grant = { role: detail.myRole, canTeach: detail.myCanTeach, workspaceType: detail.type };
  const canManageStaff = writable && grantFor(grant, 'workspace.staff.manage') !== 'none';
  const canRemoveStudents = writable && grantFor(grant, 'student.remove') !== 'none';

  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<MembershipRole | ''>('');
  const [statusFilter, setStatusFilter] = useState<MembershipStatus | ''>('');
  const q = query.trim();

  const members = useAbortableQuery([wid, q, roleFilter, statusFilter], async (signal) => {
    let result;
    try {
      result = asApiResult<MembersPage>(
        await api.GET('/workspaces/{wid}/members', {
          params: {
            path: { wid },
            query: {
              ...(q ? { q } : {}),
              ...(roleFilter ? { role: roleFilter } : {}),
              ...(statusFilter ? { status: statusFilter } : {}),
              limit: 100,
            },
          },
          signal,
        }),
      );
    } catch {
      throw new Error(t('errors.INTERNAL_ERROR'));
    }
    if (result.error) throw new Error(apiErrorMessage(t, result.error));
    return result.data?.items ?? [];
  });

  const assignments = useAbortableQuery([wid, isOrg], async (signal): Promise<Assignment[]> => {
    if (!isOrg) return [];
    const { data } = asApiResult<AssignmentsPage>(
      await api.GET('/workspaces/{wid}/assignments', {
        params: { path: { wid }, query: { limit: 100 } },
        signal,
      }),
    );
    return data?.items ?? [];
  });

  // Every member seen so far (filters narrow the table, not the names assignments resolve to).
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const items = members.data;
    if (!items || items.length === 0) return;
    setNames((prev) => {
      const next = { ...prev };
      for (const m of items) next[m.userId] = fullName(m);
      return next;
    });
  }, [members.data]);

  // Resolved after mount: the server has no viewer time zone (no hydration mismatch).
  const [viewerTimezone, setViewerTimezone] = useState('UTC');
  useEffect(() => {
    setViewerTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  const [removeTarget, setRemoveTarget] = useState<MemberSummary | null>(null);
  // Dialogs opened from a row menu have no `Trigger`: focus goes back to that row's menu button.
  const returnFocus = useReturnFocus();
  const [reportTarget, setReportTarget] = useState<MemberSummary | null>(null);

  const mutate = useSubmit(
    async (
      call: () => Promise<Parameters<typeof asApiResult>[0]>,
      success: string,
    ): Promise<boolean> => {
      try {
        const { error } = asApiResult<unknown>(await call());
        if (error) {
          toast({ title: apiErrorMessage(t, error), variant: 'danger' });
          return false;
        }
      } catch {
        toast({ title: t('errors.INTERNAL_ERROR'), variant: 'danger' });
        return false;
      } finally {
        members.reload();
      }
      toast({ title: success, variant: 'success' });
      assignments.reload();
      return true;
    },
  );

  const patchMember = (m: MemberSummary, body: { role?: MembershipRole; canTeach?: boolean }) =>
    void mutate.submit(
      () =>
        api.PATCH('/workspaces/{wid}/members/{uid}', {
          params: { path: { wid, uid: m.userId } },
          body,
        }),
      body.role ? t('members.roleChanged') : t('members.canTeachChanged'),
    );

  const columns = {
    name: t('members.name'),
    role: t('members.role'),
    canTeach: t('members.canTeach'),
    status: t('members.status'),
    joined: t('members.joined'),
  };

  const list = members.data;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-fg">{t('members.title')}</h2>

      <div
        role="group"
        aria-label={t('members.filters')}
        className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
      >
        <Field htmlFor="member-q" label={t('members.search')}>
          <Input
            id="member-q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Field htmlFor="member-role" label={t('members.role')}>
          <Select
            id="member-role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as MembershipRole | '')}
          >
            <option value="">{t('members.allRoles')}</option>
            {MEMBERSHIP_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`members.role_${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="member-status" label={t('members.status')}>
          <Select
            id="member-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as MembershipStatus | '')}
          >
            <option value="">{t('members.allStatuses')}</option>
            {MEMBERSHIP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`members.status_${s}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {members.error ? <Alert variant="danger">{members.error}</Alert> : null}

      <Card padding="none" aria-busy={members.loading}>
        {list === undefined ? (
          members.error ? null : (
            <SkeletonTable className="p-4" cols={5} />
          )
        ) : list.length === 0 ? (
          <EmptyState as="h3" icon={<Users />} title={t('members.noMatch')} />
        ) : (
          <Table caption={t('members.title')} hideCaption>
            <Table.Head>
              <Table.Row>
                <Table.Th>{columns.name}</Table.Th>
                <Table.Th>{columns.role}</Table.Th>
                <Table.Th>{columns.canTeach}</Table.Th>
                <Table.Th>{columns.status}</Table.Th>
                <Table.Th>{columns.joined}</Table.Th>
                <Table.Th>
                  <span className="sr-only">{t('members.actions')}</span>
                </Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {list.map((m) => {
                const name = fullName(m);
                const isSelf = m.userId === meId;
                const canChangeRole =
                  canManageStaff &&
                  !isSelf &&
                  (STAFF_ROLES as readonly MembershipRole[]).includes(m.role);
                const canToggleTeach = canManageStaff && !isSelf && m.role === 'ADMIN';
                const canRemove =
                  !isSelf &&
                  m.role !== 'OWNER' &&
                  (STUDENT_SIDE_ROLES.includes(m.role) ? canRemoveStudents : canManageStaff);
                const canReport = !isSelf;
                const hasMenu = canChangeRole || canToggleTeach || canRemove || canReport;
                return (
                  <Table.Row key={m.userId} data-testid={`member-${m.userId}`}>
                    <Table.Td label={columns.name}>
                      <span className="inline-flex flex-wrap items-center gap-2 font-medium">
                        {name}
                        {isSelf ? <Badge variant="neutral">{t('members.self')}</Badge> : null}
                      </span>
                      {m.email ? (
                        <span className="block text-xs text-fg-muted">{m.email}</span>
                      ) : null}
                    </Table.Td>
                    <Table.Td label={columns.role}>
                      <Badge variant={ROLE_BADGE[m.role]}>{t(`members.role_${m.role}`)}</Badge>
                    </Table.Td>
                    <Table.Td label={columns.canTeach}>
                      {m.canTeach ? t('members.yes') : t('members.no')}
                    </Table.Td>
                    <Table.Td label={columns.status}>
                      <Badge variant={statusBadge(m.status)}>
                        {t(`members.status_${m.status}`)}
                      </Badge>
                    </Table.Td>
                    <Table.Td label={columns.joined}>
                      {m.joinedAt
                        ? formatDate(new Date(m.joinedAt), locale, viewerTimezone, {
                            dateStyle: 'medium',
                          })
                        : '—'}
                    </Table.Td>
                    <Table.Actions>
                      {hasMenu ? (
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t('members.rowActions', { name })}
                              ref={returnFocus.register(m.userId)}
                            >
                              <MoreHorizontal aria-hidden="true" className="size-5" />
                            </Button>
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Content align="end">
                            {canChangeRole ? (
                              <>
                                <DropdownMenu.Label>
                                  {t('members.changeRoleFor', { name })}
                                </DropdownMenu.Label>
                                <DropdownMenu.RadioGroup
                                  value={m.role}
                                  onValueChange={(value) => {
                                    if (value !== m.role)
                                      patchMember(m, { role: value as MembershipRole });
                                  }}
                                >
                                  {STAFF_ROLES.map((r) => (
                                    <DropdownMenu.RadioItem
                                      key={r}
                                      value={r}
                                      disabled={mutate.busy}
                                    >
                                      {t(`members.role_${r}`)}
                                    </DropdownMenu.RadioItem>
                                  ))}
                                </DropdownMenu.RadioGroup>
                              </>
                            ) : null}
                            {canToggleTeach ? (
                              <DropdownMenu.CheckboxItem
                                checked={m.canTeach}
                                disabled={mutate.busy}
                                onCheckedChange={(checked) =>
                                  patchMember(m, { canTeach: checked === true })
                                }
                              >
                                {t('members.toggleCanTeach')}
                              </DropdownMenu.CheckboxItem>
                            ) : null}
                            {(canChangeRole || canToggleTeach) && (canRemove || canReport) ? (
                              <DropdownMenu.Separator />
                            ) : null}
                            {canRemove ? (
                              <DropdownMenu.Item
                                destructive
                                icon={<UserMinus />}
                                onSelect={() => {
                                  returnFocus.remember(m.userId);
                                  setRemoveTarget(m);
                                }}
                              >
                                {t('members.remove')}
                              </DropdownMenu.Item>
                            ) : null}
                            {canReport ? (
                              <DropdownMenu.Item
                                icon={<Flag />}
                                onSelect={() => {
                                  returnFocus.remember(m.userId);
                                  setReportTarget(m);
                                }}
                              >
                                {t('abuse.report')}
                              </DropdownMenu.Item>
                            ) : null}
                          </DropdownMenu.Content>
                        </DropdownMenu.Root>
                      ) : null}
                    </Table.Actions>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        )}
      </Card>

      {isOrg ? (
        <Card aria-labelledby="assignments-title">
          <Card.Header>
            <Card.Title id="assignments-title">{t('members.assignments')}</Card.Title>
            <Card.Description>{t('members.noStudents')}</Card.Description>
          </Card.Header>
          <ul className="flex flex-col gap-1 text-sm" data-testid="assignments-list">
            {(assignments.data ?? []).map((a) => {
              const unresolved = [a.teacherUserId, a.studentUserId].filter((id) => !names[id]);
              return (
                <li key={a.id} title={unresolved.length > 0 ? unresolved.join(', ') : undefined}>
                  {t('members.assignmentOf', {
                    teacher: names[a.teacherUserId] ?? shortId(a.teacherUserId),
                    student: names[a.studentUserId] ?? shortId(a.studentUserId),
                  })}
                </li>
              );
            })}
            {assignments.data && assignments.data.length === 0 ? (
              <li className="text-fg-muted">{t('members.noAssignments')}</li>
            ) : null}
          </ul>
        </Card>
      ) : null}

      <AlertDialog.Root
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        {removeTarget ? (
          <AlertDialog.Content
            title={t('members.confirmRemoveTitle', { name: fullName(removeTarget) })}
            description={t('members.confirmRemoveDescription')}
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
                      t('members.removed'),
                    )
                    .finally(() => setRemoveTarget(null));
                }}
              >
                {t('members.removeFor', { name: fullName(removeTarget) })}
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
