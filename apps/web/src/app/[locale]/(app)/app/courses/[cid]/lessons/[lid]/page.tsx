import type { MyCourseDetail, MyLessonDetail } from '@nibras/contracts';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { LessonShell } from '../../../../../../../../components/learn/lesson-shell';
import { LessonText } from '../../../../../../../../components/learn/lesson-text';
import { routing } from '../../../../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../../../../lib/api';

/**
 * A student's lesson (PRD §8.6): `GET /me/lessons/{lid}` with the course (`GET /me/courses/{cid}`:
 * its status and percent). Not enrolled, or a lesson of another course → 404; a `403` (locks,
 * access) or `409` is rendered by `LessonShell` as its state. A text body is rendered here, on the
 * server, and handed to the shell.
 */
export default async function LessonPage({
  params,
}: {
  params: Promise<{ locale: string; cid: string; lid: string }>;
}) {
  const { locale, cid, lid } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const client = await serverApi();
  const [lessonResult, courseResult] = await Promise.all([
    client
      .GET('/me/lessons/{lid}', { params: { path: { lid } } })
      .then((r) => asApiResult<MyLessonDetail>(r)),
    client
      .GET('/me/courses/{cid}', { params: { path: { cid } } })
      .then((r) => asApiResult<MyCourseDetail>(r)),
  ]);
  const error = courseResult.error ?? lessonResult.error;
  if (error?.code === 'NOT_FOUND') notFound();
  const detail = lessonResult.data;
  const course = courseResult.data;
  if (!error && (!detail || !course)) throw new Error('GET /me/lessons/{lid} failed');
  if (detail && detail.course.id !== cid) notFound();
  const courseHref = `/app/courses/${cid}`;
  const source = { kind: 'learner', lessonId: lid } as const;
  if (error || !detail || !course) {
    return <LessonShell mode="student" courseHref={courseHref} error={error} source={source} />;
  }
  return (
    <LessonShell
      mode="student"
      courseHref={courseHref}
      detail={detail}
      course={{ status: course.course.status, progressPercent: course.progressPercent }}
      source={source}
    >
      {detail.lesson.type === 'TEXT' ? (
        <LessonText content={detail.content} images={detail.images} />
      ) : null}
    </LessonShell>
  );
}
