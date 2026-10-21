import type { MyCourses as MyCoursesPayload } from '@nibras/contracts';
import { PageHeader } from '@nibras/ui';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { MyCourses } from '../../../../../components/learn/my-courses';
import { routing } from '../../../../../i18n/routing';
import { asApiResult, serverApi } from '../../../../../lib/api';

/** The student's « Mes cours » (PRD §8.6, §9.1 Cours): every enrolled course, all workspaces. */
export default async function MyCoursesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations();
  const { data } = asApiResult<MyCoursesPayload>(await (await serverApi()).GET('/me/courses'));
  if (!data) throw new Error('GET /me/courses failed');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('learn.title')} />
      <MyCourses items={data.items} />
    </div>
  );
}
