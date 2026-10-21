import type { CourseStatus } from '@nibras/contracts/web';
import { Badge, type BadgeVariant } from '@nibras/ui';
import { useTranslations } from 'next-intl';

const VARIANT: Record<CourseStatus, BadgeVariant> = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  ARCHIVED: 'warning',
};

/** A course's status (PRD §8.4.1): Brouillon · Publié · Archivé. */
export function CourseStatusBadge({ status }: { status: CourseStatus }) {
  const t = useTranslations();
  return <Badge variant={VARIANT[status]}>{t(`courses.status_${status}`)}</Badge>;
}
