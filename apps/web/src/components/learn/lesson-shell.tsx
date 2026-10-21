'use client';

import type { MyCourseDetail, MyLessonDetail, ProgressActionResult } from '@nibras/contracts';
import { Alert, PageHeader } from '@nibras/ui';
import { FileText, PlayCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Link } from '../../i18n/navigation';
import { ProgressBar } from '../courses/progress-bar';
import { CompleteButton } from './complete-button';
import { LessonNav } from './lesson-nav';
import { LessonState, type LearnError } from './lesson-state';

/**
 * Where T16's players fetch their grant: the student's `/me/lessons/{lid}/playback`, or the
 * teacher's `/workspaces/{wid}/media/{mediaId}/playback` in the preview.
 */
export type PlaybackSource =
  { kind: 'learner'; lessonId: string } | { kind: 'teacher'; wid: string; mediaId: string | null };

export interface LessonShellProps {
  mode: 'student' | 'preview';
  /** The course outline (`/app/courses/{cid}` or `/app/w/{wid}/courses/{cid}/preview`). */
  courseHref: string;
  /** The lesson, or the API's refusal (`403` locks and access, `409 MEDIA_NOT_READY`). */
  detail?: MyLessonDetail;
  error?: LearnError;
  /** Student mode: the course's status (ARCHIVED = frozen progress) and percent. */
  course?: { status: MyCourseDetail['course']['status']; progressPercent: number };
  source: PlaybackSource;
  /** A text lesson's body, rendered by the server page (`LessonText`). */
  children?: ReactNode;
}

/**
 * A lesson page (PRD §8.6): breadcrumbs course › module, the title and the course percent, then the
 * body by type — text (the server-rendered child), video or PDF (T16's players mount in the media
 * slot), « en cours de traitement » while the media is processed — then completion and
 * previous/next. A refusal of the API renders its `LessonState` instead. `preview` (the teacher):
 * no completion, no progress, nothing posted.
 */
export function LessonShell({
  mode,
  courseHref,
  detail,
  error,
  course,
  source,
  children,
}: LessonShellProps) {
  const t = useTranslations();
  const [status, setStatus] = useState(detail?.lesson.progress.status ?? 'NOT_STARTED');
  const [percent, setPercent] = useState(course?.progressPercent ?? 0);

  if (!detail) return <LessonState error={error ?? {}} courseHref={courseHref} />;

  const { lesson } = detail;
  const student = mode === 'student';
  const processing = lesson.media !== null && lesson.media.status !== 'READY';
  const frozen = course?.status !== 'PUBLISHED';
  const onResult = (result: ProgressActionResult) => {
    setStatus(result.lesson.status);
    setPercent(result.course.progressPercent);
  };
  const crumbs = student
    ? [
        <Link key="courses" href="/app/courses" className="hover:underline">
          {t('learn.title')}
        </Link>,
        <Link key="course" href={courseHref} className="hover:underline">
          {detail.course.title}
        </Link>,
        detail.module.title,
      ]
    : [
        <Link key="preview" href={courseHref} className="hover:underline">
          {t('learn.preview')}
        </Link>,
        detail.module.title,
      ];

  let body: ReactNode;
  if (processing) {
    body = <LessonState error={{ code: 'MEDIA_NOT_READY' }} courseHref={courseHref} />;
  } else if (lesson.type === 'TEXT') {
    body = children;
  } else {
    // T16 mounts the video player / PDF viewer here (`next/dynamic`, `ssr: false`), fed by
    // `detail.playback` and renewed through `source`; the watermark overlays this element.
    const Icon = lesson.type === 'VIDEO' ? PlayCircle : FileText;
    body = (
      <div
        data-testid="lesson-media"
        data-kind={lesson.type}
        data-source={source.kind}
        className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-md border border-border bg-bg-subtle text-fg-muted"
      >
        <Icon aria-hidden="true" className="size-10" />
        <p className="text-sm">{t('learn.mediaPending')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        // In the preview the course page's header holds the page's h1.
        as={student ? 'h1' : 'h2'}
        title={lesson.title}
        description={lesson.description ?? undefined}
        breadcrumbs={{ label: t('learn.breadcrumbs'), items: crumbs }}
      />
      {student ? (
        <div className="max-w-sm">
          <ProgressBar percent={percent} label={t('learn.courseProgress')} />
        </div>
      ) : (
        <Alert variant="info">{t('learn.previewNotice')}</Alert>
      )}
      {body}
      {student && !processing ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <CompleteButton
              lessonId={lesson.id}
              completed={status === 'COMPLETED'}
              disabled={frozen}
              openOnMount={!frozen && lesson.type !== 'VIDEO'}
              onResult={onResult}
            />
            <span role="status" className="text-sm text-fg-muted">
              {t(`learn.status_${status}`)}
            </span>
          </div>
          {frozen ? <p className="text-sm text-fg-muted">{t('learn.frozen')}</p> : null}
        </div>
      ) : null}
      <LessonNav
        previous={detail.previous}
        next={detail.next}
        lessonsHref={`${courseHref}/lessons`}
      />
    </div>
  );
}
