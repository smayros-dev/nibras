'use client';

import type { CourseStatus, CourseSummary, CoursesPage, WorkspaceDetail } from '@nibras/contracts';
import { grantFor } from '@nibras/contracts/web';
import { formatDate } from '@nibras/i18n';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SkeletonTable,
  Table,
  Tabs,
} from '@nibras/ui';
import { BookOpen, Plus } from 'lucide-react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { lazy, Suspense, useState } from 'react';
import { Link, useRouter } from '../../i18n/navigation';
import { api, asApiResult } from '../../lib/api';
import { apiErrorMessage } from '../../lib/api-error';
import { useAbortableQuery } from '../../lib/paged-fetch';
import { useReturnFocus } from '../../lib/use-return-focus';
import { CourseStatusBadge } from './course-status-badge';

/** Fetched on the first click of « + Créer » (PRD §14.1 budget). */
const CreateCourseDialog = lazy(() =>
  import('./create-course-dialog').then((m) => ({ default: m.CreateCourseDialog })),
);

type CoursesTab = 'all' | 'DRAFT' | 'ARCHIVED';
const TABS: { value: CoursesTab; label: string }[] = [
  { value: 'all', label: 'courses.tabAll' },
  { value: 'DRAFT', label: 'courses.tabDraft' },
  { value: 'ARCHIVED', label: 'courses.tabArchived' },
];

/**
 * The workspace's courses page (PRD §9.1 Cours, §8.4.1): « + Créer » (`CreateCourseDialog`, loaded
 * on demand; opens the new course), tabs Tous · Brouillons · Archivés (`status` filter) and a
 * debounced title search, both through `useAbortableQuery`; the table links each course to its
 * page. An organisation TEACHER sees his own courses (the API's `own` scope). Nothing yet → « Créez
 * votre premier cours ». A SUSPENDED/DELETING workspace is read-only.
 */
export function CoursesPanel({
  wid,
  detail,
}: {
  wid: string;
  detail: WorkspaceDetail;
  meId: string;
}) {
  const t = useTranslations();
  const locale = useLocale() as WorkspaceDetail['defaultLocale'];
  const timeZone = useTimeZone() ?? 'UTC';
  const router = useRouter();
  const writable = detail.status === 'ACTIVE';
  const grant = { role: detail.myRole, canTeach: detail.myCanTeach, workspaceType: detail.type };
  const canCreate = writable && grantFor(grant, 'course.create') !== 'none';

  const [tab, setTab] = useState<CoursesTab>('all');
  const [query, setQuery] = useState('');
  const q = query.trim();
  /** `null` until first opened: the dialog's chunk is fetched then. */
  const [createOpen, setCreateOpen] = useState<boolean | null>(null);
  const returnFocus = useReturnFocus();

  const courses = useAbortableQuery([wid, tab, q], async (signal) => {
    const status: CourseStatus | undefined = tab === 'all' ? undefined : tab;
    let result;
    try {
      result = asApiResult<CoursesPage>(
        await api.GET('/workspaces/{wid}/courses', {
          params: {
            path: { wid },
            query: { ...(status ? { status } : {}), ...(q ? { q } : {}), limit: 100 },
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

  const items = courses.data;
  const nothingYet = items !== undefined && items.length === 0 && tab === 'all' && q === '';

  const createButton = (
    <Button
      variant="primary"
      onClick={(event) => {
        returnFocus.remember(event.currentTarget);
        setCreateOpen(true);
      }}
    >
      <Plus aria-hidden="true" className="size-4" />
      {t('courses.create')}
    </Button>
  );

  const columns = {
    title: t('courses.colTitle'),
    status: t('courses.colStatus'),
    modules: t('courses.colModules'),
    lessons: t('courses.colLessons'),
    enrolled: t('courses.colEnrolled'),
    updated: t('courses.colUpdated'),
  };

  const table = (rows: CourseSummary[]) => (
    <Table caption={t('courses.title')} hideCaption>
      <Table.Head>
        <Table.Row>
          <Table.Th>{columns.title}</Table.Th>
          <Table.Th>{columns.status}</Table.Th>
          <Table.Th>{columns.modules}</Table.Th>
          <Table.Th>{columns.lessons}</Table.Th>
          <Table.Th>{columns.enrolled}</Table.Th>
          <Table.Th>{columns.updated}</Table.Th>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {rows.map((c) => (
          <Table.Row key={c.id} data-testid={`course-${c.id}`}>
            <Table.Td label={columns.title}>
              <Link
                href={`/app/w/${wid}/courses/${c.id}`}
                className="font-medium text-primary hover:underline"
              >
                {c.title}
              </Link>
              {detail.type === 'ORGANIZATION' ? (
                <span className="block text-xs text-fg-muted">
                  {`${c.owner.firstName} ${c.owner.lastName}`}
                </span>
              ) : null}
            </Table.Td>
            <Table.Td label={columns.status}>
              <CourseStatusBadge status={c.status} />
            </Table.Td>
            <Table.Td label={columns.modules}>{c.moduleCount}</Table.Td>
            <Table.Td label={columns.lessons}>{c.lessonCount}</Table.Td>
            <Table.Td label={columns.enrolled}>{c.enrolledCount}</Table.Td>
            <Table.Td label={columns.updated}>
              {formatDate(new Date(c.updatedAt), locale, timeZone, { dateStyle: 'medium' })}
            </Table.Td>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader as="h2" title={t('courses.title')} actions={canCreate ? createButton : null} />

      {nothingYet ? (
        <Card>
          <EmptyState
            as="h3"
            icon={<BookOpen />}
            title={t('courses.emptyTitle')}
            description={t('courses.emptyDescription')}
            action={canCreate ? createButton : undefined}
          />
        </Card>
      ) : (
        <Tabs.Root value={tab} onValueChange={(value) => setTab(value as CoursesTab)}>
          <Tabs.List aria-label={t('courses.tabs')}>
            {TABS.map((item) => (
              <Tabs.Trigger key={item.value} value={item.value}>
                {t(item.label)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <div className="max-w-md">
            <Field htmlFor="courses-q" label={t('courses.search')}>
              <Input
                id="courses-q"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </Field>
          </div>
          {courses.error ? <Alert variant="danger">{courses.error}</Alert> : null}
          {TABS.map((item) => (
            <Tabs.Content key={item.value} value={item.value}>
              <Card padding="none" aria-busy={courses.loading}>
                {items === undefined ? (
                  courses.error ? null : (
                    <SkeletonTable className="p-4" cols={6} />
                  )
                ) : items.length === 0 ? (
                  <EmptyState as="h3" icon={<BookOpen />} title={t('courses.noMatch')} />
                ) : (
                  table(items)
                )}
              </Card>
            </Tabs.Content>
          ))}
        </Tabs.Root>
      )}

      {canCreate && createOpen !== null ? (
        <Suspense fallback={null}>
          <CreateCourseDialog
            wid={wid}
            defaultLanguage={detail.defaultLocale}
            open={createOpen}
            onOpenChange={setCreateOpen}
            onCreated={(course) => {
              setCreateOpen(false);
              router.push(`/app/w/${wid}/courses/${course.id}`);
            }}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
