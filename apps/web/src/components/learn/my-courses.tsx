'use client';

import type { MyCourse } from '@nibras/contracts';
import { Badge, Card, EmptyState, Field, Select } from '@nibras/ui';
import { BookOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Link } from '../../i18n/navigation';
import { ProgressBar } from '../courses/progress-bar';

const ALL = '';

/**
 * « Mes cours » (PRD §8.6, §9.1): one card per enrolled course across every workspace — cover,
 * title, teacher, workspace, progress, « Terminé » / « Archivé » badges — in the API's order (last
 * activity first), filterable by workspace when there is more than one.
 */
export function MyCourses({ items }: { items: MyCourse[] }) {
  const t = useTranslations();
  const [workspace, setWorkspace] = useState(ALL);
  const workspaces = useMemo(() => {
    const byId = new Map<string, string>();
    for (const item of items) byId.set(item.course.workspace.id, item.course.workspace.name);
    return [...byId].map(([id, name]) => ({ id, name }));
  }, [items]);
  const shown =
    workspace === ALL ? items : items.filter((i) => i.course.workspace.id === workspace);

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          as="h2"
          icon={<BookOpen />}
          title={t('learn.empty')}
          description={t('learn.emptyDescription')}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {workspaces.length > 1 ? (
        <div className="max-w-xs">
          <Field label={t('learn.filterWorkspace')}>
            <Select value={workspace} onChange={(event) => setWorkspace(event.target.value)}>
              <option value={ALL}>{t('learn.allWorkspaces')}</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map(({ course, progressPercent, completedAt }) => (
          <li key={course.id}>
            <Card padding="none" className="h-full">
              {course.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- presigned URL of the media store
                <img
                  src={course.coverUrl}
                  alt=""
                  loading="lazy"
                  className="aspect-video w-full object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="flex aspect-video w-full items-center justify-center bg-primary-subtle text-primary"
                >
                  <BookOpen className="size-10" />
                </div>
              )}
              <div className="flex flex-1 flex-col gap-2 p-4">
                <h2 className="text-lg font-semibold text-fg">
                  <Link href={`/app/courses/${course.id}`} className="hover:underline">
                    {course.title}
                  </Link>
                </h2>
                <p className="text-sm text-fg-muted">
                  {t('learn.teacher', {
                    name: `${course.teacher.firstName} ${course.teacher.lastName}`,
                  })}
                  <br />
                  {course.workspace.name}
                </p>
                <div className="flex flex-wrap gap-2">
                  {completedAt ? <Badge variant="success">{t('learn.completed')}</Badge> : null}
                  {course.status === 'ARCHIVED' ? (
                    <Badge variant="neutral">{t('courses.status_ARCHIVED')}</Badge>
                  ) : null}
                </div>
                <div className="mt-auto pt-2">
                  <ProgressBar percent={progressPercent} label={t('learn.courseProgress')} />
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
