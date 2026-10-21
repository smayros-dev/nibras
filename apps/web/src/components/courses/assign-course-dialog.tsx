'use client';

import type { CoursesPage, CourseSummary } from '@nibras/contracts';
import { Alert, Button, Dialog, Field, Select, Spinner, useSubmit, useToast } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, asApiResult } from '../../lib/api';
import { apiErrorMessage } from '../../lib/api-error';
import { useAbortableQuery } from '../../lib/paged-fetch';

/**
 * « Attribuer un cours » on a student's profile (PRD §8.3.1, §8.5.1): picks one of the
 * workspace's DRAFT or PUBLISHED courses (`GET …/courses?status=…`, scoped by the API — an
 * organisation TEACHER lists his own) that the student is not ACTIVE on, and posts him
 * (`POST …/courses/{cid}/enrollments`). Mounted on the first click by the profile.
 */
export function AssignCourseDialog({
  wid,
  uid,
  name,
  enrolledCourseIds,
  open,
  onOpenChange,
  onAssigned,
  onCloseAutoFocus,
}: {
  wid: string;
  uid: string;
  name: string;
  enrolledCourseIds: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations();
  const { toast } = useToast();
  const [courseId, setCourseId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const courses = useAbortableQuery(
    [wid, open],
    async (signal) => {
      const pages = await Promise.all(
        (['PUBLISHED', 'DRAFT'] as const).map(async (status) => {
          const result = asApiResult<CoursesPage>(
            await api.GET('/workspaces/{wid}/courses', {
              params: { path: { wid }, query: { status, limit: 100 } },
              signal,
            }),
          );
          if (result.error) throw new Error(apiErrorMessage(t, result.error));
          return result.data?.items ?? [];
        }),
      ).catch((error: unknown) => {
        throw error instanceof Error ? error : new Error(t('errors.INTERNAL_ERROR'));
      });
      return pages
        .flat()
        .filter((c: Pick<CourseSummary, 'id'>) => !enrolledCourseIds.includes(c.id))
        .sort((a, b) => a.title.localeCompare(b.title));
    },
    { debounceMs: 0 },
  );

  const submit = useSubmit(async () => {
    setFormError(null);
    try {
      const { error } = asApiResult<unknown>(
        await api.POST('/workspaces/{wid}/courses/{cid}/enrollments', {
          params: { path: { wid, cid: courseId } },
          body: { studentUserIds: [uid] },
        }),
      );
      if (error) {
        setFormError(apiErrorMessage(t, error));
        return;
      }
    } catch {
      setFormError(t('errors.INTERNAL_ERROR'));
      return;
    }
    toast({ title: t('enrollments.courseAssigned'), variant: 'success' });
    setCourseId('');
    onAssigned();
    onOpenChange(false);
  });

  const candidates = courses.data;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        title={t('enrollments.assignCourseTitle', { name })}
        closeLabel={t('common.close')}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form
          method="post"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (courseId) void submit.submit();
          }}
        >
          {(formError ?? courses.error) ? (
            <Alert variant="danger">{formError ?? courses.error}</Alert>
          ) : null}
          {candidates === undefined ? (
            courses.error ? null : (
              <Spinner label={t('common.loading')} />
            )
          ) : candidates.length === 0 ? (
            <p className="text-fg-muted">{t('enrollments.noAssignable')}</p>
          ) : (
            <Field htmlFor="assign-course" label={t('enrollments.pickCourse')} required>
              <Select
                id="assign-course"
                name="courseId"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                required
              >
                <option value="" disabled>
                  {t('enrollments.pickCoursePlaceholder')}
                </option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Dialog.Footer>
            <Dialog.Close asChild>
              <Button variant="secondary">{t('common.cancel')}</Button>
            </Dialog.Close>
            <Button type="submit" variant="primary" loading={submit.busy} disabled={!courseId}>
              {t('enrollments.assignSubmit')}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
