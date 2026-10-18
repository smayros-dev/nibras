'use client';

import { Skeleton, SkeletonTable, VisuallyHidden } from '@nibras/ui';
import { useTranslations } from 'next-intl';

/** `loading.tsx` placeholder: a page-header skeleton and a table skeleton, announced once. */
export function PageSkeleton() {
  const t = useTranslations('errorPages');
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div role="status">
        <VisuallyHidden>{t('loading')}</VisuallyHidden>
      </div>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton className="h-8 w-1/2 max-w-sm" />
        <Skeleton className="h-4 w-2/3 max-w-md" />
      </div>
      <SkeletonTable />
    </div>
  );
}
