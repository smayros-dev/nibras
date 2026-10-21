'use client';

import type { GrantContext } from '@nibras/contracts/web';
import { Card, SkeletonText, Tabs, useCurrentPath } from '@nibras/ui';
import { useLocale, useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { lazy, Suspense, type ReactNode } from 'react';
import { usePathname } from '../../i18n/navigation';
import { useCourse } from '../../lib/courses';
import { localizedPath } from '../shell-path-provider';
import { CourseHeader } from './course-header';
import { CourseSettingsForm } from './course-settings-form';
import { EnrollmentsPanel } from './enrollments-panel';

/** The structure editor (dnd-kit, dialogs, upload engine) loads with the tab (PRD §14.1 budget). */
const StructurePanel = lazy(() =>
  import('./structure-panel').then((m) => ({ default: m.StructurePanel })),
);

const TABS = [
  { value: 'structure', segment: '', label: 'courses.tabStructure' },
  { value: 'students', segment: '/students', label: 'courses.tabStudents' },
  { value: 'settings', segment: '/settings', label: 'courses.tabSettings' },
] as const;

/**
 * The course page's frame (inside `CourseProvider`): `CourseHeader` bound to the held course and
 * the link tabs Structure · Étudiants · Paramètres (real URLs; the active one follows the live
 * path like `WorkspaceTabs`).
 */
export function CourseFrame({
  meId,
  grant,
  children,
}: {
  meId: string;
  grant: GrantContext;
  children: ReactNode;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { wid, writable, course, setCourse } = useCourse();
  const ownPath = localizedPath(locale, usePathname());
  const pathname = useCurrentPath() ?? ownPath;
  const base = `/${locale}/app/w/${wid}/courses/${course.id}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : '';
  const segment = rest.split('/')[1] ?? '';
  const value = segment === '' ? 'structure' : segment;

  return (
    <div className="flex flex-col gap-6">
      <CourseHeader
        wid={wid}
        meId={meId}
        course={course}
        grant={grant}
        writable={writable}
        onChanged={setCourse}
      />
      <Tabs.Root asLinks value={value}>
        <Tabs.List aria-label={t('courses.sections')}>
          {TABS.map((tab) => (
            <Tabs.Trigger key={tab.value} value={tab.value} asChild>
              <NextLink href={`${base}${tab.segment}`}>{t(tab.label)}</NextLink>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>
      <div>{children}</div>
    </div>
  );
}

/** The Paramètres tab: `CourseSettingsForm` on the held course. */
export function CourseSettings() {
  const { wid, writable, course, setCourse, reload } = useCourse();
  return (
    <CourseSettingsForm
      wid={wid}
      course={course}
      writable={writable}
      onChanged={setCourse}
      onReload={reload}
    />
  );
}

/** The Structure tab: the lazily loaded `StructurePanel` on the held course. */
export function CourseStructure() {
  const { wid, writable, course, reload } = useCourse();
  return (
    <Suspense
      fallback={
        <Card>
          <SkeletonText lines={4} />
        </Card>
      }
    >
      <StructurePanel
        wid={wid}
        courseId={course.id}
        writable={writable}
        onCourseChanged={() => void reload()}
      />
    </Suspense>
  );
}

/** The Étudiants tab: `EnrollmentsPanel` on the held course (static: see its budget note). */
export function CourseStudents() {
  const { wid, writable, course, reload } = useCourse();
  return (
    <EnrollmentsPanel
      wid={wid}
      course={course}
      writable={writable}
      onChanged={() => void reload()}
    />
  );
}
