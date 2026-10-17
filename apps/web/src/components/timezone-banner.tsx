'use client';

import type { MeUser } from '@tt/contracts';
import { Alert, Button, useSubmit } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useRouter } from '../i18n/navigation';
import { api, asApiResult } from '../lib/api';

const DISMISS_KEY = 'tt.tzBanner.dismissedAt';
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

function readDismissedAt(): number {
  try {
    return Number(localStorage.getItem(DISMISS_KEY) ?? 0);
  } catch {
    return 0;
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Storage blocked: the banner simply comes back next time.
  }
}

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
    setVisible(resolved !== timezone && Date.now() - readDismissedAt() >= DISMISS_MS);
  }, [timezone]);

  const accept = useSubmit(async () => {
    setError(false);
    try {
      const { error: patchError } = asApiResult<MeUser>(
        await api.PATCH('/me', { body: { timezone: browserTz ?? undefined } }),
      );
      if (patchError) {
        setError(true);
        return;
      }
    } catch {
      setError(true);
      return;
    }
    rememberDismissed();
    setVisible(false);
    router.refresh();
  });

  if (!visible || !browserTz) return null;
  const city = (browserTz.split('/').pop() ?? browserTz).replace(/_/g, ' ');

  function dismiss() {
    rememberDismissed();
    setVisible(false);
  }

  return (
    // A standing prompt, not an announcement: no live region (it would also collide with the
    // pages' own `status` messages).
    <Alert
      variant="info"
      role={undefined}
      className="mb-4"
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            loading={accept.busy}
            onClick={() => void accept.submit()}
          >
            {t('settings.timezone.accept')}
          </Button>
          <Button variant="secondary" size="sm" disabled={accept.busy} onClick={dismiss}>
            {t('settings.timezone.dismiss')}
          </Button>
        </div>
      }
    >
      <p>{t('settings.timezone.banner', { city, tz: browserTz })}</p>
      {error ? (
        <p role="alert" className="mt-1 text-danger">
          {t('errors.INTERNAL_ERROR')}
        </p>
      ) : null}
    </Alert>
  );
}
