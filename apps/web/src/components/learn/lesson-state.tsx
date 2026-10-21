import type { Lock } from '@nibras/contracts';
import { Button, Card, EmptyState } from '@nibras/ui';
import { Ban, CircleAlert, Hourglass, Lock as LockIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';
import { apiErrorMessage } from '../../lib/api-error';

type Translate = ReturnType<typeof useTranslations>;

/** « Terminez le module {title} ({percent} %) » / « Terminez la leçon précédente » (PRD §8.5.2). */
export function lockMessage(t: Translate, lock: Lock): string {
  return lock.reason === 'PREVIOUS_MODULE_INCOMPLETE'
    ? t('learn.moduleLocked', {
        title: lock.previousModule.title,
        percent: lock.previousModule.percent,
      })
    : t('learn.lessonLocked', { title: lock.previousLesson.title });
}

/** A lock as the API sends it in a `403 MODULE_LOCKED | LESSON_LOCKED` body, or `null`. */
export function asLock(details: unknown): Lock | null {
  const lock = details as Partial<Lock> | null | undefined;
  if (lock?.reason === 'PREVIOUS_MODULE_INCOMPLETE' && 'previousModule' in lock)
    return lock as Lock;
  if (lock?.reason === 'PREVIOUS_LESSON_INCOMPLETE' && 'previousLesson' in lock)
    return lock as Lock;
  return null;
}

/** An API refusal of a learn route (`/me/courses/{cid}`, `/me/lessons/{lid}`). */
export interface LearnError {
  code?: string;
  details?: unknown;
}

/**
 * Why a course or lesson cannot be shown, as a full-card state: locked (with what to finish),
 * media in processing, access revoked, course no longer available, or the API's own message.
 * Locked and processing lead back to the course; the others to « Mes cours ».
 */
export function LessonState({
  error,
  courseHref,
}: {
  error: LearnError;
  /** The course outline; `undefined` on the course page itself. */
  courseHref?: string;
}) {
  const t = useTranslations();
  const code = error.code;
  let icon = <CircleAlert />;
  let title: string;
  let description: string | undefined;
  let back = { href: '/app/courses', label: t('learn.backToCourses') };
  const toCourse = courseHref ? { href: courseHref, label: t('learn.backToCourse') } : back;
  if (code === 'MODULE_LOCKED' || code === 'LESSON_LOCKED') {
    const lock = asLock(error.details);
    icon = <LockIcon />;
    title = t('learn.lockedTitle');
    description = lock ? lockMessage(t, lock) : apiErrorMessage(t, error);
    back = toCourse;
  } else if (code === 'MEDIA_NOT_READY') {
    icon = <Hourglass />;
    title = t('learn.processing');
    description = t('learn.processingDescription');
    back = toCourse;
  } else if (code === 'ENROLLMENT_REVOKED') {
    icon = <Ban />;
    title = t('learn.revoked');
  } else if (code === 'COURSE_NOT_AVAILABLE') {
    icon = <Ban />;
    title = t('learn.unavailable');
    description = t('learn.unavailableDescription');
  } else {
    title = apiErrorMessage(t, error);
  }
  return (
    <Card>
      <EmptyState
        as="h2"
        icon={icon}
        title={title}
        description={description}
        action={
          <Button variant="secondary" asChild>
            <Link href={back.href}>{back.label}</Link>
          </Button>
        }
      />
    </Card>
  );
}
