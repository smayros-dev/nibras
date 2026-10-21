'use client';

import type { MembershipStatus, StudentsPage } from '@nibras/contracts';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  Spinner,
  useSubmit,
  useToast,
} from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, asApiResult } from '../../lib/api';
import { apiErrorMessage } from '../../lib/api-error';
import { useAbortableQuery } from '../../lib/paged-fetch';

/**
 * Memberships the API accepts in `POST …/enrollments` (spec §4.5): ACTIVE, and the two consent
 * statuses, whose students are pre-assigned (the course opens once the guardian consents).
 */
const ASSIGNABLE: readonly MembershipStatus[] = [
  'ACTIVE',
  'PENDING_GUARDIAN_CONSENT',
  'SUSPENDED_NO_CONSENT',
];
const CONSENT_PENDING: readonly MembershipStatus[] = [
  'PENDING_GUARDIAN_CONSENT',
  'SUSPENDED_NO_CONSENT',
];

/** `details.issues[i].path = ['studentUserIds', n]` of a `422` → the indexes refused. */
function refusedIndexes(error: unknown): number[] {
  const body = error as { code?: string; details?: { issues?: { path?: unknown[] }[] } } | null;
  if (body?.code !== 'VALIDATION_FAILED') return [];
  return (body.details?.issues ?? [])
    .map((issue) => issue.path)
    .filter((path): path is unknown[] => Array.isArray(path) && path[0] === 'studentUserIds')
    .map((path) => path[1])
    .filter((index): index is number => typeof index === 'number');
}

/**
 * « Attribuer » on a course (PRD §8.5.1; AC-ENR-01 UI): searches the workspace's students
 * (`GET …/students?q`, already scoped by the API — an organisation TEACHER sees his own),
 * offers the assignable ones not yet enrolled as checkbox rows, and posts the selection
 * (`POST …/courses/{cid}/enrollments`). A `422` names each refused `studentUserIds[i]`: the rows
 * show why and the dialog stays open. Mounted on the first click by `EnrollmentsPanel`.
 */
export function AssignStudentsDialog({
  wid,
  courseId,
  courseTitle,
  enrolledIds,
  open,
  onOpenChange,
  onAssigned,
  onCloseAutoFocus,
}: {
  wid: string;
  courseId: string;
  courseTitle: string;
  /** Students already ACTIVE on the course (not offered). */
  enrolledIds: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const q = query.trim();
  /** In selection order: a `422` index points into it. */
  const [selected, setSelected] = useState<string[]>([]);
  const [refused, setRefused] = useState<ReadonlySet<string>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);

  const students = useAbortableQuery([wid, q, open], async (signal) => {
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
    return (result.data?.items ?? []).filter(
      (s) => ASSIGNABLE.includes(s.status) && !enrolledIds.includes(s.userId),
    );
  });

  const toggle = (uid: string, on: boolean) => {
    setSelected((ids) =>
      on ? [...ids.filter((id) => id !== uid), uid] : ids.filter((id) => id !== uid),
    );
    setRefused((ids) => {
      if (!ids.has(uid)) return ids;
      const next = new Set(ids);
      next.delete(uid);
      return next;
    });
  };

  const submit = useSubmit(async () => {
    setFormError(null);
    const ids = selected;
    let error: unknown;
    try {
      ({ error } = asApiResult<unknown>(
        await api.POST('/workspaces/{wid}/courses/{cid}/enrollments', {
          params: { path: { wid, cid: courseId } },
          body: { studentUserIds: ids },
        }),
      ));
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    if (error) {
      const indexes = refusedIndexes(error);
      if (indexes.length > 0) {
        setRefused(new Set(indexes.map((i) => ids[i]).filter((id): id is string => !!id)));
        setFormError(t('enrollments.refused'));
      } else {
        setFormError(apiErrorMessage(t, error));
      }
      return;
    }
    toast({ title: t('enrollments.assigned', { count: ids.length }), variant: 'success' });
    setSelected([]);
    setRefused(new Set());
    onAssigned();
    onOpenChange(false);
  });

  const candidates = students.data;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        title={t('enrollments.assignTitle', { title: courseTitle })}
        closeLabel={t('common.close')}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form
          method="post"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (selected.length > 0) void submit.submit();
          }}
        >
          {(formError ?? students.error) ? (
            <Alert variant="danger">{formError ?? students.error}</Alert>
          ) : null}
          <Field htmlFor="assign-students-q" label={t('enrollments.search')}>
            <Input
              id="assign-students-q"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          {candidates === undefined ? (
            students.error ? null : (
              <Spinner label={t('common.loading')} />
            )
          ) : candidates.length === 0 ? (
            <p className="text-fg-muted">{t('enrollments.noCandidates')}</p>
          ) : (
            <fieldset
              className="flex max-h-80 flex-col overflow-y-auto"
              aria-busy={students.loading}
            >
              <legend className="sr-only">{t('enrollments.search')}</legend>
              {candidates.map((s) => {
                const hints = [
                  CONSENT_PENDING.includes(s.status) ? t('enrollments.consentPending') : null,
                  refused.has(s.userId) ? t('enrollments.rowRefused') : null,
                ].filter((hint): hint is string => hint !== null);
                return (
                  <Checkbox
                    key={s.userId}
                    label={`${s.firstName} ${s.lastName}`}
                    checked={selected.includes(s.userId)}
                    onCheckedChange={(checked) => toggle(s.userId, checked === true)}
                    aria-invalid={refused.has(s.userId) || undefined}
                    description={
                      hints.length > 0 ? (
                        <span className={refused.has(s.userId) ? 'text-danger' : undefined}>
                          {hints.join(' ')}
                        </span>
                      ) : undefined
                    }
                  />
                );
              })}
            </fieldset>
          )}
          <p className="text-sm text-fg-muted" aria-live="polite">
            {t('enrollments.selected', { count: selected.length })}
          </p>
          <Dialog.Footer>
            <Dialog.Close asChild>
              <Button variant="secondary">{t('common.cancel')}</Button>
            </Dialog.Close>
            <Button
              type="submit"
              variant="primary"
              loading={submit.busy}
              disabled={selected.length === 0}
            >
              {t('enrollments.assignSubmit')}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
