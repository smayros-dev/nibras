'use client';

import {
  MEMBERSHIP_ROLES,
  MEMBERSHIP_STATUSES,
  type Assignment,
  type MemberSummary,
  type MembersPage,
  type MembershipRole,
  type MembershipStatus,
  type WorkspaceDetail,
} from '@tt/contracts';
import { Button, Field, Select, TextInput } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ReportAbuseButton } from './report-abuse-button';
import { apiErrorMessage } from '../lib/api-error';
import { api, asApiResult } from '../lib/api';

/**
 * Workspace members (PRD §9.2/§11.1): filters, role changes (ADMIN↔TEACHER only), canTeach
 * toggle for admins, removal with confirm, per-row *Signaler* (PRD §11.7) and, for an
 * ORGANIZATION, the teacher → students assignment panel (PRD §11.2). Students join by
 * invitation in SP2, so the student list is empty in SP1.
 */
export function MembersPanel({ wid, detail }: { wid: string; detail: WorkspaceDetail }) {
  const t = useTranslations();
  const isOrg = detail.type === 'ORGANIZATION';

  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [roleFilter, setRoleFilter] = useState<MembershipRole | ''>('');
  const [statusFilter, setStatusFilter] = useState<MembershipStatus | ''>('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const { data, error: getError } = asApiResult<MembersPage>(
      await api.GET('/workspaces/{wid}/members', {
        params: {
          path: { wid },
          query: {
            ...(roleFilter ? { role: roleFilter } : {}),
            ...(statusFilter ? { status: statusFilter } : {}),
            ...(query ? { q: query } : {}),
            limit: 100,
          },
        },
      }),
    );
    if (getError) setError(apiErrorMessage(t, getError as unknown));
    else setMembers(data?.items ?? []);
    if (isOrg) {
      const { data: page } = asApiResult<{ items: Assignment[] }>(
        await api.GET('/workspaces/{wid}/assignments', {
          params: { path: { wid }, query: { limit: 100 } },
        }),
      );
      setAssignments(page?.items ?? []);
    }
  }, [wid, roleFilter, statusFilter, query, isOrg, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeRole(member: MemberSummary, role: 'ADMIN' | 'TEACHER') {
    setError(null);
    setStatus(null);
    const { error: patchError } = asApiResult<unknown>(
      await api.PATCH('/workspaces/{wid}/members/{uid}', {
        params: { path: { wid, uid: member.userId } },
        body: { role },
      }),
    );
    if (patchError) setError(apiErrorMessage(t, patchError as unknown));
    else setStatus(t('members.roleChanged'));
    await load();
  }

  async function toggleCanTeach(member: MemberSummary) {
    setError(null);
    setStatus(null);
    const { error: patchError } = asApiResult<unknown>(
      await api.PATCH('/workspaces/{wid}/members/{uid}', {
        params: { path: { wid, uid: member.userId } },
        body: { canTeach: !member.canTeach },
      }),
    );
    if (patchError) setError(apiErrorMessage(t, patchError as unknown));
    else setStatus(t('members.roleChanged'));
    await load();
  }

  async function removeMember(member: MemberSummary) {
    if (
      !window.confirm(
        t('members.removeConfirm', { name: `${member.firstName} ${member.lastName}` }),
      )
    ) {
      return;
    }
    setError(null);
    setStatus(null);
    const { error: deleteError } = asApiResult<unknown>(
      await api.DELETE('/workspaces/{wid}/members/{uid}', {
        params: { path: { wid, uid: member.userId } },
      }),
    );
    if (deleteError) setError(apiErrorMessage(t, deleteError as unknown));
    else setStatus(t('members.removed'));
    await load();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">{t('members.title')}</h1>
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

      <div className="flex flex-wrap items-end gap-3">
        <Field htmlFor="member-q" label={t('members.search')}>
          <TextInput id="member-q" value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <Field htmlFor="member-role" label={t('members.role')}>
          <Select
            id="member-role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as MembershipRole | '')}
          >
            <option value="">—</option>
            {MEMBERSHIP_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
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
            <option value="">—</option>
            {MEMBERSHIP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <table className="w-full max-w-3xl border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-300 text-start">
            <th className="py-1 text-start">{t('settings.profile.firstName')}</th>
            <th className="py-1 text-start">{t('members.role')}</th>
            <th className="py-1 text-start">{t('members.canTeach')}</th>
            <th className="py-1 text-start">{t('members.status')}</th>
            <th className="py-1 text-start">{t('members.joined')}</th>
            <th className="py-1 text-start">{t('members.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr
              key={member.userId}
              data-testid={`member-${member.userId}`}
              className="border-b border-gray-100"
            >
              <td className="py-1">
                {member.firstName} {member.lastName}
                {member.email ? (
                  <span className="block text-xs text-gray-500">{member.email}</span>
                ) : null}
              </td>
              <td className="py-1">{member.role}</td>
              <td className="py-1">
                {member.role === 'ADMIN' || member.role === 'OWNER' ? (
                  <input
                    type="checkbox"
                    aria-label={`${t('members.toggleCanTeach')} — ${member.firstName} ${member.lastName}`}
                    checked={member.canTeach}
                    onChange={() => void toggleCanTeach(member)}
                    className="size-4"
                  />
                ) : (
                  String(member.canTeach)
                )}
              </td>
              <td className="py-1">{member.status}</td>
              <td className="py-1">{member.joinedAt ? member.joinedAt.slice(0, 10) : '—'}</td>
              <td className="py-1">
                <div className="flex flex-wrap items-center gap-2">
                  {member.role === 'ADMIN' || member.role === 'TEACHER' ? (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void changeRole(member, member.role === 'ADMIN' ? 'TEACHER' : 'ADMIN')
                      }
                    >
                      {t('members.changeRole')}
                    </Button>
                  ) : null}
                  {member.role !== 'OWNER' ? (
                    <Button variant="danger" onClick={() => void removeMember(member)}>
                      {t('members.remove')}
                    </Button>
                  ) : null}
                  <ReportAbuseButton workspaceId={wid} entityType="USER" entityId={member.userId} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {isOrg ? (
        <section aria-label={t('members.assignments')} className="flex max-w-md flex-col gap-2">
          <h2 className="text-lg font-semibold">{t('members.assignments')}</h2>
          <p className="text-sm text-gray-600">{t('members.noStudents')}</p>
          <ul className="text-sm" data-testid="assignments-list">
            {assignments.map((assignment) => (
              <li key={assignment.id}>
                {assignment.teacherUserId} → {assignment.studentUserId}
              </li>
            ))}
            {assignments.length === 0 ? <li>—</li> : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
