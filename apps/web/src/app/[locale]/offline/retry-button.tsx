'use client';

import { Button } from '@nibras/ui';
import { useTranslations } from 'next-intl';

/**
 * Reloads the current URL: the service worker serves the offline page in place of the page the
 * user was navigating to, so a reload retries that page (and shows it once the network is back).
 */
export function RetryButton() {
  const t = useTranslations('pwa');
  return (
    <Button variant="primary" onClick={() => location.reload()}>
      {t('retry')}
    </Button>
  );
}
