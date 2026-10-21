import { Button } from '@nibras/ui';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';

/** Previous / next lesson links (course order); a missing side is simply not shown. */
export function LessonNav({
  previous,
  next,
  lessonsHref,
}: {
  previous: { lessonId: string } | null;
  next: { lessonId: string } | null;
  /** `…/lessons`: each link is `${lessonsHref}/{lid}`. */
  lessonsHref: string;
}) {
  const t = useTranslations();
  if (!previous && !next) return null;
  return (
    <nav aria-label={t('learn.lessonNav')} className="flex flex-wrap justify-between gap-3">
      {previous ? (
        <Button variant="secondary" asChild>
          <Link href={`${lessonsHref}/${previous.lessonId}`}>
            <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
            {t('learn.previous')}
          </Link>
        </Button>
      ) : (
        <span />
      )}
      {next ? (
        <Button variant="secondary" asChild>
          <Link href={`${lessonsHref}/${next.lessonId}`}>
            {t('learn.next')}
            <ArrowRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
          </Link>
        </Button>
      ) : null}
    </nav>
  );
}
