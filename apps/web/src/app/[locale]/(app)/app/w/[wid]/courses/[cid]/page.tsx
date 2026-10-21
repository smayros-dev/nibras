import { Card, EmptyState } from '@nibras/ui';
import { ListTree } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/** The course's Structure tab: modules and lessons (the editor is SP3 T12). */
export default async function CourseStructurePage() {
  const t = await getTranslations();
  return (
    <Card>
      <EmptyState as="h3" icon={<ListTree />} title={t('courses.structureSoon')} />
    </Card>
  );
}
