import { Card, EmptyState } from '@nibras/ui';
import { GraduationCap } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/** The course's Étudiants tab: enrollments (the panel is SP3 T14). */
export default async function CourseStudentsPage() {
  const t = await getTranslations();
  return (
    <Card>
      <EmptyState as="h3" icon={<GraduationCap />} title={t('courses.studentsSoon')} />
    </Card>
  );
}
