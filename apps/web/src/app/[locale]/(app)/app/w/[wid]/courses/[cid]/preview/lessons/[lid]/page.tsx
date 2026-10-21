import type { CourseStructure, LessonDetail } from '@nibras/contracts';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { previewLessonDetail } from '../../../../../../../../../../../components/learn/course-outline';
import { LessonShell } from '../../../../../../../../../../../components/learn/lesson-shell';
import { LessonText } from '../../../../../../../../../../../components/learn/lesson-text';
import { routing } from '../../../../../../../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../../../../../../../lib/api';
import { getSession } from '../../../../../../../../../../../lib/session';

/**
 * A lesson in the teacher's preview: `LessonShell` in `preview` mode on the teacher's lesson
 * (`GET …/lessons/{lid}`) placed in the structure's order; media through the teacher's playback
 * route, watermarked with the teacher's email. Nothing is posted.
 */
export default async function PreviewLessonPage({
  params,
}: {
  params: Promise<{ locale: string; wid: string; cid: string; lid: string }>;
}) {
  const { locale, wid, cid, lid } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const client = await serverApi();
  const [{ data: structure }, { data: lesson }, user] = await Promise.all([
    client
      .GET('/workspaces/{wid}/courses/{cid}/structure', { params: { path: { wid, cid } } })
      .then((r) => asApiResult<CourseStructure>(r)),
    client
      .GET('/workspaces/{wid}/lessons/{lid}', { params: { path: { wid, lid } } })
      .then((r) => asApiResult<LessonDetail>(r)),
    getSession(),
  ]);
  const detail = structure && lesson ? previewLessonDetail(structure, lesson) : null;
  if (!detail || !lesson) notFound();
  return (
    <LessonShell
      mode="preview"
      courseHref={`/app/w/${wid}/courses/${cid}/preview`}
      detail={detail}
      source={{ kind: 'teacher', wid, mediaId: lesson.mediaAssetId }}
      viewerEmail={user?.email ?? ''}
    >
      {lesson.type === 'TEXT' ? (
        <LessonText content={lesson.content} images={lesson.images} />
      ) : null}
    </LessonShell>
  );
}
