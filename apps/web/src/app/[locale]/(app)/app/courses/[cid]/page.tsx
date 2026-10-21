import type { MyCourseDetail } from '@nibras/contracts';
import { Alert, PageHeader } from '@nibras/ui';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ProgressBar } from '../../../../../../components/courses/progress-bar';
import { CourseOutline } from '../../../../../../components/learn/course-outline';
import { LessonState } from '../../../../../../components/learn/lesson-state';
import { RichText } from '../../../../../../components/rich-text/renderer';
import { Link } from '../../../../../../i18n/navigation';
import { routing } from '../../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../../lib/api';

/**
 * A student's course (PRD §8.6): header with teacher and progress, the description and the outline
 * with locks (`GET /me/courses/{cid}`). Not enrolled → 404; a `403` (revoked, unpublished, consent
 * pending…) is its state card, not a 404. An archived course is read-only (frozen progress).
 */
export default async function MyCoursePage({
  params,
}: {
  params: Promise<{ locale: string; cid: string }>;
}) {
  const { locale, cid } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations();
  const { data, error } = asApiResult<MyCourseDetail>(
    await (await serverApi()).GET('/me/courses/{cid}', { params: { path: { cid } } }),
  );
  if (error?.code === 'NOT_FOUND') notFound();
  if (!data) {
    if (!error) throw new Error('GET /me/courses/{cid} failed');
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('learn.title')} />
        <LessonState error={error} />
      </div>
    );
  }
  const { course } = data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={course.title}
        description={`${t('learn.teacher', {
          name: `${course.teacher.firstName} ${course.teacher.lastName}`,
        })} · ${course.workspace.name}`}
        breadcrumbs={{
          label: t('learn.breadcrumbs'),
          items: [
            <Link key="courses" href="/app/courses" className="hover:underline">
              {t('learn.title')}
            </Link>,
            course.title,
          ],
        }}
      />
      <div className="max-w-sm">
        <ProgressBar percent={data.progressPercent} label={t('learn.courseProgress')} />
      </div>
      {course.status === 'ARCHIVED' ? <Alert variant="info">{t('learn.frozen')}</Alert> : null}
      {course.description ? <RichText doc={course.description} /> : null}
      <CourseOutline
        modules={data.modules}
        next={course.status === 'ARCHIVED' ? null : data.next}
        mode="student"
        hrefBase={`/app/courses/${cid}`}
      />
    </div>
  );
}
