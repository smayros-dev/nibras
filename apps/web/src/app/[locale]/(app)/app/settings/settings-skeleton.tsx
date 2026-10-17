'use client';

import { Card, Skeleton, SkeletonText, VisuallyHidden } from '@tt/ui';
import { useTranslations } from 'next-intl';

/**
 * `loading.tsx` of a settings tab: the layout (title, tabs) stays, the tab body is a card of
 * field placeholders (`table` for list tabs), announced once.
 */
export function SettingsSkeleton({ variant = 'form' }: { variant?: 'form' | 'list' }) {
  const t = useTranslations('errorPages');
  return (
    <div className="flex max-w-3xl flex-col gap-6" aria-busy="true">
      <div role="status">
        <VisuallyHidden>{t('loading')}</VisuallyHidden>
      </div>
      <Card aria-hidden="true">
        <Skeleton className="h-6 w-1/3" />
        {variant === 'form' ? (
          Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))
        ) : (
          <SkeletonText lines={4} />
        )}
      </Card>
    </div>
  );
}
