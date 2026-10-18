'use client';

import { Button } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { StatusPage } from '../../components/status-page';
import { Link } from '../../i18n/navigation';

/**
 * Error boundary of every page under the locale layout (translated, RTL in `ar`). Server errors
 * reach the client without their message; `digest` is the reference that matches the server log.
 * `retry` (Next 16.2+) re-fetches and re-renders the segment; `reset` is the older fallback.
 */
export default function ErrorPage({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  const t = useTranslations('errorPages');
  return (
    <StatusPage
      title={t('title')}
      description={t('description')}
      details={
        error.digest ? (
          <p className="text-sm text-fg-subtle">{t('requestId', { id: error.digest })}</p>
        ) : null
      }
      actions={
        <>
          <Button variant="primary" onClick={() => (retry ?? reset)?.()}>
            {t('retry')}
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/">{t('home')}</Link>
          </Button>
        </>
      }
    />
  );
}
