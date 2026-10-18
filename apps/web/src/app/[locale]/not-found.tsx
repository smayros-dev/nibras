'use client';

import { Button } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { StatusPage } from '../../components/status-page';
import { Link } from '../../i18n/navigation';

/**
 * Translated 404 inside the locale layout (so `lang`/`dir` are right): `notFound()` from any page
 * or layout under `[locale]` and unmatched paths (the `[...rest]` catch-all) land here.
 */
export default function NotFound() {
  const t = useTranslations('errorPages');
  return (
    <StatusPage
      code="404"
      title={t('notFoundTitle')}
      description={t('notFoundDescription')}
      actions={
        <Button variant="primary" asChild>
          <Link href="/">{t('home')}</Link>
        </Button>
      }
    />
  );
}
