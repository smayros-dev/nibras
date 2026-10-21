import { screen, within } from '@testing-library/react';
import type { CourseStructure } from '@nibras/contracts';
import { describe, expect, it } from 'vitest';
import { renderWithIntl, tr } from '../../test/render';
import { CourseOutline, previewLessonDetail, previewModules } from './course-outline';
import { myLesson, myModule } from '../../test/learn-fixtures';

const fill = (key: string, values: Record<string, string | number>) =>
  tr('fr', key).replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

const MODULES = [
  myModule(
    'm1',
    [
      myLesson('l1', {
        title: 'Introduction',
        progress: { status: 'COMPLETED', completedAt: '2026-10-18T08:00:00.000Z' },
      }),
      myLesson('l2', {
        title: 'Les fractions',
        type: 'VIDEO',
        position: 2,
        estimatedMinutes: null,
        media: { status: 'READY', durationS: 600, pageCount: null },
      }),
      myLesson('l3', {
        title: 'Exercices',
        type: 'PDF',
        position: 3,
        estimatedMinutes: null,
        media: { status: 'READY', durationS: null, pageCount: 12 },
        locked: true,
        lock: {
          reason: 'PREVIOUS_LESSON_INCOMPLETE',
          previousLesson: { id: 'l2', title: 'Les fractions' },
        },
      }),
    ],
    { title: 'Bases', percent: 33 },
  ),
  myModule('m2', [myLesson('l4', { title: 'Équations', locked: true })], {
    title: 'Avancé',
    position: 2,
    percent: 0,
    unlockRule: { type: 'PREVIOUS_MODULE_COMPLETED' },
    locked: true,
    lock: {
      reason: 'PREVIOUS_MODULE_INCOMPLETE',
      previousModule: { id: 'm1', title: 'Bases', percent: 80 },
    },
  }),
];

describe('CourseOutline (student)', () => {
  function renderStudent(next: { lessonId: string } | null = { lessonId: 'l2' }) {
    return renderWithIntl(
      <CourseOutline modules={MODULES} next={next} mode="student" hrefBase="/app/courses/c1" />,
    );
  }

  it('links unlocked lessons and shows type, duration and status', () => {
    renderStudent();
    expect(screen.getByRole('link', { name: /Introduction/ })).toHaveAttribute(
      'href',
      '/app/courses/c1/lessons/l1',
    );
    const row = screen.getByRole('link', { name: /Les fractions/ }).closest('li')!;
    expect(within(row).getByText(new RegExp(tr('fr', 'structure.type_VIDEO')))).toBeInTheDocument();
    expect(
      within(row).getByText(new RegExp(fill('learn.minutes', { minutes: 10 }))),
    ).toBeInTheDocument();
    expect(screen.getByText(tr('fr', 'learn.status_COMPLETED'))).toBeInTheDocument();
  });

  it('renders locked lessons and modules as disabled rows with their reason', () => {
    renderStudent();
    expect(screen.queryByRole('link', { name: /Exercices/ })).not.toBeInTheDocument();
    const locked = screen.getByText('Exercices').closest('[aria-disabled="true"]');
    expect(locked).not.toBeNull();
    expect(
      screen.getByText(fill('learn.lessonLocked', { title: 'Les fractions' })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill('learn.moduleLocked', { title: 'Bases', percent: 80 })),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Équations/ })).not.toBeInTheDocument();
  });

  it('shows each module percent as a progress bar', () => {
    renderStudent();
    const bars = screen.getAllByRole('progressbar');
    expect(bars.map((b) => b.getAttribute('aria-valuenow'))).toEqual(['33', '0']);
  });

  it('« Continuer » goes to the next lesson; absent when there is none', () => {
    const { unmount } = renderStudent();
    expect(screen.getByRole('link', { name: tr('fr', 'learn.continue') })).toHaveAttribute(
      'href',
      '/app/courses/c1/lessons/l2',
    );
    unmount();
    renderStudent(null);
    expect(
      screen.queryByRole('link', { name: tr('fr', 'learn.continue') }),
    ).not.toBeInTheDocument();
  });
});

describe('CourseOutline (preview)', () => {
  const structure: CourseStructure = {
    courseId: 'c1',
    version: 4,
    status: 'DRAFT',
    sequentialLessons: true,
    modules: [
      {
        id: 'm1',
        title: 'Bases',
        description: null,
        position: 1,
        isOptional: false,
        unlockRule: { type: 'NONE' },
        version: 1,
        lessons: [
          {
            id: 'l1',
            moduleId: 'm1',
            title: 'Introduction',
            description: null,
            type: 'TEXT',
            position: 1,
            isRequired: true,
            estimatedMinutes: 5,
            allowDownload: false,
            mediaAssetId: null,
            media: null,
            hasContent: true,
            version: 1,
          },
        ],
      },
      {
        id: 'm2',
        title: 'Avancé',
        description: null,
        position: 2,
        isOptional: true,
        unlockRule: { type: 'PREVIOUS_MODULE_COMPLETED' },
        version: 1,
        lessons: [
          {
            id: 'l2',
            moduleId: 'm2',
            title: 'Équations',
            description: null,
            type: 'TEXT',
            position: 1,
            isRequired: true,
            estimatedMinutes: null,
            allowDownload: false,
            mediaAssetId: null,
            media: null,
            hasContent: true,
            version: 1,
          },
        ],
      },
    ],
  };

  it('has no locks and no progress; every lesson links to the preview route', () => {
    renderWithIntl(
      <CourseOutline
        modules={previewModules(structure)}
        next={null}
        mode="preview"
        hrefBase="/app/w/w1/courses/c1/preview"
      />,
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(tr('fr', 'learn.status_NOT_STARTED'))).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Équations/ })).toHaveAttribute(
      'href',
      '/app/w/w1/courses/c1/preview/lessons/l2',
    );
    expect(screen.getByText(tr('fr', 'structure.optional'))).toBeInTheDocument();
  });
  it('previewLessonDetail places a lesson in the course order; null outside the course', () => {
    const lesson = { ...structure.modules[1]!.lessons[0]!, content: null, images: {} };
    const detail = previewLessonDetail(structure, lesson)!;
    expect(detail.module).toEqual({ id: 'm2', title: 'Avancé' });
    expect(detail.previous).toEqual({ lessonId: 'l1' });
    expect(detail.next).toBeNull();
    expect(detail.lesson.locked).toBe(false);
    expect(previewLessonDetail(structure, { ...lesson, id: 'other' })).toBeNull();
  });
});
