import { Card, EmptyState, PageHeader } from '@nibras/ui';
import { BookOpen } from 'lucide-react';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '../../../../../i18n/routing';

/** The student's « Mes cours » (PRD §9.1 Cours): the shell entry; the list is SP3 T15. */
export default async function MyCoursesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('courses.myCoursesTitle')} />
      <Card>
        <EmptyState as="h2" icon={<BookOpen />} title={t('courses.myCoursesSoon')} />
      </Card>
    </div>
  );
}
