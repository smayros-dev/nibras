import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProgressActionResult } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { myLesson, myLessonDetail } from '../../test/learn-fixtures';
import { renderWithIntl, tr } from '../../test/render';
import { LessonShell, type LessonShellProps } from './lesson-shell';

const api = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock('../../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const fill = (key: string, values: Record<string, string | number>) =>
  tr('fr', key).replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

function action(
  status: ProgressActionResult['lesson']['status'],
  progressPercent: number,
): { data: ProgressActionResult } {
  return {
    data: {
      lesson: {
        id: 'l1',
        status,
        completedAt: status === 'COMPLETED' ? '2026-10-21T08:00:00.000Z' : null,
      },
      course: { progressPercent, completedAt: null },
    },
  };
}

const STUDENT: Omit<LessonShellProps, 'detail' | 'error'> = {
  mode: 'student',
  courseHref: '/app/courses/c1',
  course: { status: 'PUBLISHED', progressPercent: 40 },
  source: { kind: 'learner', lessonId: 'l1' },
};

function renderShell(props: Partial<LessonShellProps> = {}) {
  return renderWithIntl(
    <LessonShell {...STUDENT} detail={myLessonDetail()} {...props}>
      <p>Corps de la leçon</p>
    </LessonShell>,
  );
}

beforeEach(() => {
  api.POST.mockReset();
  api.POST.mockImplementation(async (path: string) => {
    if (path === '/me/lessons/{lid}/opened') return action('IN_PROGRESS', 40);
    if (path === '/me/lessons/{lid}/complete') return action('COMPLETED', 50);
    if (path === '/me/lessons/{lid}/uncomplete') return action('IN_PROGRESS', 40);
    throw new Error(path);
  });
});

describe('LessonShell — states by error code', () => {
  it('MODULE_LOCKED shows the lock with the module to finish', () => {
    renderShell({
      detail: undefined,
      error: {
        code: 'MODULE_LOCKED',
        details: {
          reason: 'PREVIOUS_MODULE_INCOMPLETE',
          previousModule: { id: 'm0', title: 'Bases', percent: 80 },
        },
      },
    });
    expect(
      screen.getByRole('heading', { name: tr('fr', 'learn.lockedTitle') }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill('learn.moduleLocked', { title: 'Bases', percent: 80 })),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: tr('fr', 'learn.backToCourse') })).toHaveAttribute(
      'href',
      '/app/courses/c1',
    );
    expect(screen.queryByText('Corps de la leçon')).not.toBeInTheDocument();
  });

  it('LESSON_LOCKED names the previous lesson', () => {
    renderShell({
      detail: undefined,
      error: {
        code: 'LESSON_LOCKED',
        details: {
          reason: 'PREVIOUS_LESSON_INCOMPLETE',
          previousLesson: { id: 'l0', title: 'Introduction' },
        },
      },
    });
    expect(
      screen.getByText(fill('learn.lessonLocked', { title: 'Introduction' })),
    ).toBeInTheDocument();
  });

  it.each([
    ['ENROLLMENT_REVOKED', 'learn.revoked'],
    ['COURSE_NOT_AVAILABLE', 'learn.unavailable'],
  ])('%s → its state with a link to « Mes cours »', (code, key) => {
    renderShell({ detail: undefined, error: { code } });
    expect(screen.getByRole('heading', { name: tr('fr', key) })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: tr('fr', 'learn.backToCourses') })).toHaveAttribute(
      'href',
      '/app/courses',
    );
  });

  it('MEDIA_NOT_READY → processing', () => {
    renderShell({ detail: undefined, error: { code: 'MEDIA_NOT_READY' } });
    expect(screen.getByRole('heading', { name: tr('fr', 'learn.processing') })).toBeInTheDocument();
  });

  it('another code shows its API message', () => {
    renderShell({ detail: undefined, error: { code: 'GUARDIAN_CONSENT_REQUIRED' } });
    expect(
      screen.getByRole('heading', { name: tr('fr', 'errors.GUARDIAN_CONSENT_REQUIRED') }),
    ).toBeInTheDocument();
  });
});

describe('LessonShell — lesson', () => {
  it('renders the breadcrumbs, the body and the previous/next links', () => {
    renderShell({ detail: myLessonDetail({ previous: { lessonId: 'l0' } }) });
    expect(screen.getByRole('heading', { level: 1, name: 'Les fractions' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Algèbre 1' })).toHaveAttribute(
      'href',
      '/app/courses/c1',
    );
    expect(screen.getByText('Corps de la leçon')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: tr('fr', 'learn.previous') })).toHaveAttribute(
      'href',
      '/app/courses/c1/lessons/l0',
    );
    expect(screen.getByRole('link', { name: tr('fr', 'learn.next') })).toHaveAttribute(
      'href',
      '/app/courses/c1/lessons/l2',
    );
  });

  it('posts opened on mount for a text lesson', async () => {
    renderShell();
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/me/lessons/{lid}/opened', {
        params: { path: { lid: 'l1' } },
      }),
    );
  });

  it('complete and uncomplete toggle the button and update the course percent', async () => {
    renderShell();
    const bar = screen.getByRole('progressbar', { name: tr('fr', 'learn.courseProgress') });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    await userEvent.click(screen.getByRole('button', { name: tr('fr', 'learn.markComplete') }));
    expect(api.POST).toHaveBeenCalledWith('/me/lessons/{lid}/complete', {
      params: { path: { lid: 'l1' } },
    });
    expect(
      await screen.findByRole('button', { name: tr('fr', 'learn.unmarkComplete') }),
    ).toBeInTheDocument();
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    await userEvent.click(screen.getByRole('button', { name: tr('fr', 'learn.unmarkComplete') }));
    expect(api.POST).toHaveBeenCalledWith('/me/lessons/{lid}/uncomplete', {
      params: { path: { lid: 'l1' } },
    });
    expect(
      await screen.findByRole('button', { name: tr('fr', 'learn.markComplete') }),
    ).toBeInTheDocument();
    expect(bar).toHaveAttribute('aria-valuenow', '40');
  });

  it('an API refusal is shown and the status does not change', async () => {
    api.POST.mockImplementation(async (path: string) =>
      path.endsWith('/complete')
        ? { error: { code: 'LESSON_NOT_OPENED', message: 'x' } }
        : action('IN_PROGRESS', 40),
    );
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: tr('fr', 'learn.markComplete') }));
    expect(await screen.findByText(tr('fr', 'errors.LESSON_NOT_OPENED'))).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: tr('fr', 'learn.markComplete') }),
    ).toBeInTheDocument();
  });

  it('an archived course is read-only: no completion, no opened', () => {
    renderShell({ course: { status: 'ARCHIVED', progressPercent: 40 } });
    expect(screen.getByRole('button', { name: tr('fr', 'learn.markComplete') })).toBeDisabled();
    expect(screen.getByText(tr('fr', 'learn.frozen'))).toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();
  });

  it('a video in processing shows the processing state and posts nothing', () => {
    renderShell({
      detail: myLessonDetail({
        lesson: myLesson('l1', {
          type: 'VIDEO',
          media: { status: 'PROCESSING', durationS: null, pageCount: null },
        }),
        content: null,
      }),
    });
    expect(screen.getByRole('heading', { name: tr('fr', 'learn.processing') })).toBeInTheDocument();
    expect(screen.queryByTestId('lesson-media')).not.toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();
  });

  it('a ready video gets the media slot and is not opened on mount', () => {
    renderShell({
      detail: myLessonDetail({
        lesson: myLesson('l1', {
          type: 'VIDEO',
          media: { status: 'READY', durationS: 600, pageCount: null },
        }),
        content: null,
        playback: {
          kind: 'MP4',
          url: 'https://s3.test/v.mp4',
          expiresAt: '2026-10-21T10:00:00.000Z',
        },
      }),
    });
    expect(screen.getByTestId('lesson-media')).toHaveAttribute('data-kind', 'VIDEO');
    expect(screen.queryByText('Corps de la leçon')).not.toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();
  });

  it('preview: no completion, no progress, no API call, a preview notice', () => {
    renderShell({
      mode: 'preview',
      courseHref: '/app/w/w1/courses/c1/preview',
      course: undefined,
      source: { kind: 'teacher', wid: 'w1', mediaId: null },
    });
    expect(
      screen.queryByRole('button', { name: tr('fr', 'learn.markComplete') }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText(tr('fr', 'learn.previewNotice'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: tr('fr', 'learn.next') })).toHaveAttribute(
      'href',
      '/app/w/w1/courses/c1/preview/lessons/l2',
    );
    expect(api.POST).not.toHaveBeenCalled();
  });

  it('renders in RTL', () => {
    renderWithIntl(
      <LessonShell {...STUDENT} detail={myLessonDetail()}>
        <p>نص</p>
      </LessonShell>,
      { locale: 'ar' },
    );
    expect(
      screen.getByRole('button', { name: tr('ar', 'learn.markComplete') }),
    ).toBeInTheDocument();
  });
});
