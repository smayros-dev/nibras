'use client';

import type { CurrentConsentType } from '@tt/contracts';
import { Button } from '@tt/ui';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '../i18n/navigation';
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
 * (the gate disappears once `pendingConsents` is empty). No `aria-hidden`/`inert` on the app
 * content behind it — the overlay keeps pointer and keyboard focus inside the dialog.
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
        setError(t('errors.INTERNAL_ERROR'));
        setBusy(false);
        return;
      }
    }
    // Re-run the (app) layout server component: pendingConsents is now empty and the gate unmounts.
    router.refresh();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-gate-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
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
