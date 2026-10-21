import type {
  CourseStructure,
  LessonDetail,
  MyLesson,
  MyLessonDetail,
  MyModule,
} from '@nibras/contracts';
import { Badge, Button } from '@nibras/ui';
import {
  ArrowRight,
  Circle,
  CircleCheck,
  CircleDot,
  FileText,
  Lock,
  PlayCircle,
  Type,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';
import { ProgressBar } from '../courses/progress-bar';
import { lockMessage } from './lesson-state';

type Translate = ReturnType<typeof useTranslations>;

const TYPE_ICON = { VIDEO: PlayCircle, PDF: FileText, TEXT: Type } as const;

/**
 * The teacher's structure as the outline's modules (preview mode): nothing locked, no progress —
 * the teacher sees every lesson as his students would once they are unlocked.
 */
export function previewModules(structure: CourseStructure): MyModule[] {
  return structure.modules.map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    position: m.position,
    isOptional: m.isOptional,
    unlockRule: m.unlockRule,
    percent: 0,
    locked: false,
    lock: null,
    lessons: m.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      description: l.description,
      type: l.type,
      position: l.position,
      isRequired: l.isRequired,
      estimatedMinutes: l.estimatedMinutes,
      allowDownload: l.allowDownload,
      media: l.media
        ? { status: l.media.status, durationS: l.media.durationS, pageCount: l.media.pageCount }
        : null,
      progress: { status: 'NOT_STARTED', completedAt: null },
      locked: false,
      lock: null,
    })),
  }));
}

/**
 * A teacher's lesson (`GET …/lessons/{lid}`) as the shell's detail in preview mode, placed in the
 * course order for previous/next; `null` when the lesson is not in this course's structure.
 */
export function previewLessonDetail(
  structure: CourseStructure,
  lesson: LessonDetail,
): MyLessonDetail | null {
  const flat = previewModules(structure).flatMap((m) => m.lessons.map((l) => ({ m, l })));
  const index = flat.findIndex((entry) => entry.l.id === lesson.id);
  const here = flat[index];
  if (!here) return null;
  const around = (i: number) => (flat[i] ? { lessonId: flat[i].l.id } : null);
  return {
    lesson: here.l,
    course: { id: structure.courseId, title: '' },
    module: { id: here.m.id, title: here.m.title },
    content: lesson.content,
    images: lesson.images,
    playback: null,
    previous: around(index - 1),
    next: around(index + 1),
  };
}

/** « 12 min » (estimate, else the video's duration) or « 8 p. » (a PDF's pages). */
function lessonLength(t: Translate, lesson: MyLesson): string | null {
  if (lesson.estimatedMinutes) return t('learn.minutes', { minutes: lesson.estimatedMinutes });
  if (lesson.media?.durationS) {
    return t('learn.minutes', { minutes: Math.max(1, Math.ceil(lesson.media.durationS / 60)) });
  }
  if (lesson.media?.pageCount) return t('learn.pages', { pages: lesson.media.pageCount });
  return null;
}

function StatusIcon({ lesson }: { lesson: MyLesson }) {
  const cls = 'size-5 shrink-0';
  if (lesson.locked) return <Lock aria-hidden="true" className={`${cls} text-fg-muted`} />;
  if (lesson.progress.status === 'COMPLETED') {
    return <CircleCheck aria-hidden="true" className={`${cls} text-success`} />;
  }
  if (lesson.progress.status === 'IN_PROGRESS') {
    return <CircleDot aria-hidden="true" className={`${cls} text-primary`} />;
  }
  return <Circle aria-hidden="true" className={`${cls} text-fg-muted`} />;
}

function LessonRow({
  lesson,
  module,
  mode,
  hrefBase,
}: {
  lesson: MyLesson;
  module: MyModule;
  mode: 'student' | 'preview';
  hrefBase: string;
}) {
  const t = useTranslations();
  const TypeIcon = TYPE_ICON[lesson.type];
  const length = lessonLength(t, lesson);
  const status = lesson.locked
    ? t('learn.lockedLesson')
    : t(`learn.status_${lesson.progress.status}`);
  const meta = (
    <span className="flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
      <span className="inline-flex items-center gap-1">
        <TypeIcon aria-hidden="true" className="size-4" />
        {t(`structure.type_${lesson.type}`)}
      </span>
      {length ? <span>· {length}</span> : null}
      {lesson.isRequired ? null : <span>· {t('learn.optionalLesson')}</span>}
    </span>
  );
  // A lesson behind a module lock repeats nothing: the module states the reason once.
  const reason =
    lesson.locked && lesson.lock && !module.locked ? lockMessage(t, lesson.lock) : null;
  return (
    <li className="flex items-start gap-3 py-3">
      {mode === 'student' ? <StatusIcon lesson={lesson} /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {lesson.locked ? (
          <span aria-disabled="true" className="font-medium text-fg-muted">
            {lesson.title}
            <span className="sr-only"> ({status})</span>
          </span>
        ) : (
          <Link
            href={`${hrefBase}/lessons/${lesson.id}`}
            className="font-medium text-primary hover:underline"
          >
            {lesson.title}
            {mode === 'student' ? <span className="sr-only"> ({status})</span> : null}
          </Link>
        )}
        {meta}
        {reason ? <span className="text-sm text-fg-muted">{reason}</span> : null}
      </div>
      {mode === 'student' && !lesson.locked ? (
        <span className="hidden shrink-0 text-sm text-fg-muted sm:inline" aria-hidden="true">
          {status}
        </span>
      ) : null}
    </li>
  );
}

/**
 * A course outline (PRD §8.6): « Continuer » to the next lesson, then each module with its percent
 * and lock reason, and its lessons with status, type and length. Locked rows are not links
 * (`aria-disabled`, reason as text). `preview` (the teacher's view): no locks, no progress, links
 * to the preview lesson route. Server-renderable: no state, no handlers.
 */
export function CourseOutline({
  modules,
  next,
  mode,
  hrefBase,
}: {
  modules: MyModule[];
  next: { lessonId: string } | null;
  mode: 'student' | 'preview';
  /** `/app/courses/{cid}` or `/app/w/{wid}/courses/{cid}/preview`; lessons live under `/lessons/{lid}`. */
  hrefBase: string;
}) {
  const t = useTranslations();
  return (
    <section aria-labelledby="course-outline-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="course-outline-title" className="text-lg font-semibold text-fg">
          {t('learn.outline')}
        </h2>
        {next ? (
          <Button variant="primary" asChild>
            <Link href={`${hrefBase}/lessons/${next.lessonId}`}>
              {t('learn.continue')}
              <ArrowRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
            </Link>
          </Button>
        ) : null}
      </div>
      <ol className="flex flex-col gap-4">
        {modules.map((module) => (
          <li key={module.id}>
            <section
              aria-labelledby={`module-${module.id}`}
              className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4 sm:p-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3
                  id={`module-${module.id}`}
                  className="flex items-center gap-2 font-semibold text-fg"
                >
                  {module.locked ? (
                    <Lock aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
                  ) : null}
                  {module.title}
                  {module.isOptional ? (
                    <Badge variant="neutral">{t('structure.optional')}</Badge>
                  ) : null}
                </h3>
                {mode === 'student' ? (
                  <ProgressBar
                    percent={module.percent}
                    label={t('learn.moduleProgress', { title: module.title })}
                  />
                ) : null}
              </div>
              {module.locked && module.lock ? (
                <p className="text-sm text-fg-muted">{lockMessage(t, module.lock)}</p>
              ) : null}
              <ol
                aria-label={t('learn.lessonsOf', { title: module.title })}
                className="divide-y divide-border"
              >
                {module.lessons.map((lesson) => (
                  <LessonRow
                    key={lesson.id}
                    lesson={lesson}
                    module={module}
                    mode={mode}
                    hrefBase={hrefBase}
                  />
                ))}
              </ol>
            </section>
          </li>
        ))}
      </ol>
    </section>
  );
}
