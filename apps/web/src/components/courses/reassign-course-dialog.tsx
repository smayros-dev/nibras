'use client';

import type { CourseDetail, MemberSummary, MembersPage } from '@nibras/contracts';
import { Alert, Button, Dialog, Field, Select, Spinner, useSubmit, useToast } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, asApiResult } from '../../lib/api';
import { apiErrorMessage } from '../../lib/api-error';
import { useAbortableQuery } from '../../lib/paged-fetch';

/** Who may own a course (the API's rule): an ACTIVE TEACHER, or ADMIN/OWNER with `canTeach`. */
const canOwn = (m: MemberSummary) =>
  m.status === 'ACTIVE' &&
  (m.role === 'TEACHER' || (['ADMIN', 'OWNER'].includes(m.role) && m.canTeach));

/**
 * « Réaffecter » (organisation ADMIN/OWNER, `course.reassign`): picks the course's new owner among
 * the workspace's teachers; `POST …/reassign` answers the updated course. Loaded on demand.
 */
export function ReassignCourseDialog({
  wid,
  course,
  open,
  onOpenChange,
  onReassigned,
  onCloseAutoFocus,
}: {
  wid: string;
  course: CourseDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReassigned: (course: CourseDetail) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations();
  const { toast } = useToast();
  const [owner, setOwner] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const members = useAbortableQuery(
    [wid, open],
    async (signal) => {
      const result = asApiResult<MembersPage>(
        await api.GET('/workspaces/{wid}/members', {
          params: { path: { wid }, query: { status: 'ACTIVE', limit: 100 } },
          signal,
        }),
      );
      if (result.error) throw new Error(apiErrorMessage(t, result.error));
      return (result.data?.items ?? []).filter((m) => canOwn(m) && m.userId !== course.ownerUserId);
    },
    { debounceMs: 0 },
  );

  const submit = useSubmit(async () => {
    setFormError(null);
    try {
      const { data, error } = asApiResult<CourseDetail>(
        await api.POST('/workspaces/{wid}/courses/{cid}/reassign', {
          params: { path: { wid, cid: course.id } },
          body: { ownerUserId: owner },
        }),
      );
      if (error || !data) {
        setFormError(apiErrorMessage(t, error ?? null));
        return;
      }
      toast({ title: t('courses.reassigned'), variant: 'success' });
      onReassigned(data);
      onOpenChange(false);
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
    }
  });

  const candidates = members.data;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        title={t('courses.reassignTitle')}
        closeLabel={t('common.close')}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form
          method="post"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (owner) void submit.submit();
          }}
        >
          {(formError ?? members.error) ? (
            <Alert variant="danger">{formError ?? members.error}</Alert>
          ) : null}
          {candidates === undefined ? (
            members.error ? null : (
              <Spinner label={t('common.loading')} />
            )
          ) : candidates.length === 0 ? (
            <p className="text-fg-muted">{t('courses.reassignNone')}</p>
          ) : (
            <Field htmlFor="reassign-owner" label={t('courses.reassignTo')} required>
              <Select
                id="reassign-owner"
                name="ownerUserId"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                required
              >
                <option value="" disabled>
                  {t('courses.reassignPick')}
                </option>
                {candidates.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {`${m.firstName} ${m.lastName}`}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Dialog.Footer>
            <Dialog.Close asChild>
              <Button variant="secondary">{t('common.cancel')}</Button>
            </Dialog.Close>
            <Button type="submit" variant="primary" loading={submit.busy} disabled={!owner}>
              {t('courses.reassignSubmit')}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
