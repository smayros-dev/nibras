'use client';

import type { CurrentConsentType } from '@tt/contracts';
import { Button } from '@tt/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '../i18n/navigation';
import { apiErrorMessage } from '../lib/api-error';
import { api } from '../lib/api';

const CONSENT_LABEL_KEYS: Record<CurrentConsentType, string> = {
  TERMS: 'auth.consent.terms',
  PRIVACY: 'auth.consent.privacy',
  CODE_OF_CONDUCT: 'auth.consent.coc',
  MARKETING: 'auth.consent.coc', // never pending (not in REQUIRED_CONSENTS); satisfies the type
};

/**
 * Blocking modal over the app while required consents are pending: lists each pending type at
 * its current version and POSTs the grants on accept, then re-renders the server layout
 * (the gate disappears once `pendingConsents` is empty). `aria-modal` hides the background from
 * assistive tech; focus starts inside the dialog and Tab/Shift+Tab cycle within it (the gate is
 * not dismissible, so Escape closes nothing). Server-side `CONSENT_REQUIRED` still refuses every
 * app call until the grants land.
 */
export function ConsentGate({
  pending,
  versions,
}: {
  pending: readonly CurrentConsentType[];
  versions: Record<string, string>;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  /** Keep Tab inside the dialog while it blocks the app. */
  function trapTab(event: React.KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!nodes || nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function accept() {
    setBusy(true);
    setError(null);
    for (const type of pending) {
      const version = versions[type];
      if (!version) continue; // every pending type must have a current version from the layout
      const { error: grantError } = await api.POST('/me/consents/{type}', {
        params: { path: { type } },
        body: { version },
      });
      if (grantError) {
        setError(apiErrorMessage(t, grantError as unknown));
        setBusy(false);
        return;
      }
    }
    // Re-run the (app) layout server component: pendingConsents is now empty and the gate unmounts.
    router.refresh();
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-gate-title"
      tabIndex={-1}
      onKeyDown={trapTab}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 outline-none"
    >
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
        <h2 id="consent-gate-title" className="mb-2 text-xl font-bold">
          {t('auth.consent.title')}
        </h2>
        <p className="mb-4 text-sm">{t('auth.consent.intro')}</p>
        <ul className="mb-4 list-disc ps-5 text-sm">
          {pending.map((type) => (
            <li key={type}>
              {t(CONSENT_LABEL_KEYS[type])} — {versions[type]}
            </li>
          ))}
        </ul>
        {error ? (
          <p role="alert" className="mb-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button variant="primary" onClick={() => void accept()} disabled={busy}>
          {t('auth.consent.accept')}
        </Button>
      </div>
    </div>
  );
}
