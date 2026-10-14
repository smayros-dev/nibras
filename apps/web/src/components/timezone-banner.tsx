'use client';

import type { MeUser } from '@tt/contracts';
import { Button } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useRouter } from '../i18n/navigation';
import { api, asApiResult } from '../lib/api';

const DISMISS_KEY = 'tt.tzBanner.dismissedAt';
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * PRD §8.7.5: when the browser's resolved time zone differs from the profile's, offer to switch
 * (*Oui* → `PATCH /me`, *Non* → dismissed, remembered in `localStorage` for 30 days).
 */
export function TimezoneBanner({ timezone }: { timezone: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [browserTz, setBrowserTz] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setBrowserTz(resolved);
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    setVisible(resolved !== timezone && Date.now() - dismissedAt >= DISMISS_MS);
  }, [timezone]);

  if (!visible || !browserTz) return null;
  const city = browserTz.split('/').pop() ?? browserTz;

  async function accept() {
    setError(false);
    const { error: patchError } = asApiResult<MeUser>(
      await api.PATCH('/me', { body: { timezone: browserTz ?? undefined } }),
    );
    if (patchError) {
      setError(true);
      return;
    }
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
    router.refresh();
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-accent-200 bg-accent-50 px-4 py-2 text-sm">
      <p className="flex-1">{t('settings.timezone.banner', { city, tz: browserTz })}</p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {t('errors.INTERNAL_ERROR')}
        </p>
      ) : null}
      <Button variant="primary" onClick={() => void accept()}>
        {t('settings.timezone.accept')}
      </Button>
      <Button variant="secondary" onClick={dismiss}>
        {t('settings.timezone.dismiss')}
      </Button>
    </div>
  );
}
