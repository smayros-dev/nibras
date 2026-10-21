import type { CourseStructure } from '@nibras/contracts';
import { Alert } from '@nibras/ui';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import {
  CourseOutline,
  previewModules,
} from '../../../../../../../../../components/learn/course-outline';
import { routing } from '../../../../../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../../../../../lib/api';

/**
 * The teacher's student preview of a course (PRD §8.4.1): the outline from the structure
 * (`GET …/courses/{cid}/structure`), no locks, no progress; lessons open in the preview.
 */
export default async function CoursePreviewPage({
  params,
}: {
  params: Promise<{ locale: string; wid: string; cid: string }>;
}) {
  const { locale, wid, cid } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations();
  const { data } = asApiResult<CourseStructure>(
    await (
      await serverApi()
    ).GET('/workspaces/{wid}/courses/{cid}/structure', { params: { path: { wid, cid } } }),
  );
  if (!data) notFound();
  return (
    <div className="flex flex-col gap-6">
      <Alert variant="info">{t('learn.previewNotice')}</Alert>
      <CourseOutline
        modules={previewModules(data)}
        next={null}
        mode="preview"
        hrefBase={`/app/w/${wid}/courses/${cid}/preview`}
      />
    </div>
  );
}
