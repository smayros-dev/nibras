'use client';

import type { MeUser } from '@nibras/contracts';
import { Alert, Button, useSubmit } from '@nibras/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
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
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(0);

  // The in-flow spacer at the end of the page matches the floating card, so the page can always be
  // scrolled clear of it (nothing stays hidden underneath).
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const measure = () => setCardHeight(card.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [visible, browserTz]);

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

  // Out of the page flow: the banner can only mount after hydration (the server cannot know the
  // browser's zone), and at the top of the page it would push everything down under the user's
  // pointer — a click aimed at a tab or link landed on whatever slid into its place. It floats
  // above the mobile bottom nav (h-16 + safe area), at the inline-start corner on desktop (toasts
  // use the end corner); the layout renders it after the page content, where its spacer goes.
  return (
    <>
      <div
        aria-hidden="true"
        data-timezone-banner-spacer=""
        className="shrink-0"
        style={{ blockSize: `calc(${cardHeight}px + 1rem)` }}
      />
      <div
        ref={cardRef}
        data-timezone-banner=""
        className="fixed start-4 end-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 lg:end-auto lg:bottom-4 lg:w-full lg:max-w-md"
      >
        {/* A standing prompt, not an announcement: no live region (it would also collide with the
          pages' own `status` messages). */}
        <Alert
          variant="info"
          role={undefined}
          className="shadow-lg"
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
      </div>
    </>
  );
}
