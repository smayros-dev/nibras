'use client';

import type { CurrentConsentType } from '@tt/contracts';
import { Alert, Badge, Button, Dialog, useSubmit } from '@tt/ui';
import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link, useRouter } from '../i18n/navigation';
import { apiErrorMessage } from '../lib/api-error';
import { api } from '../lib/api';
import { useErrorFocus } from '../lib/use-error-focus';

type LegalHref = '/legal/terms' | '/legal/privacy' | '/legal/code-of-conduct';

const COC_ROW = {
  label: 'auth.consent.coc',
  read: 'auth.consent.readCoc',
  href: '/legal/code-of-conduct',
} as const;

const CONSENT_ROWS: Record<CurrentConsentType, { label: string; read: string; href: LegalHref }> = {
  TERMS: { label: 'auth.consent.terms', read: 'auth.consent.readTerms', href: '/legal/terms' },
  PRIVACY: {
    label: 'auth.consent.privacy',
    read: 'auth.consent.readPrivacy',
    href: '/legal/privacy',
  },
  CODE_OF_CONDUCT: COC_ROW,
  MARKETING: COC_ROW, // never pending (not in REQUIRED_CONSENTS); satisfies the type
};

/** Keeps the gate open: it is not dismissible (no Escape, no outside click, no close button). */
const keepOpen = (event: Event) => event.preventDefault();

/**
 * Blocking dialog over the app while required consents are pending: lists each pending type at
 * its current version with a link to read it (new tab), and POSTs the grants on accept, then
 * re-renders the server layout (the gate disappears once `pendingConsents` is empty; a version
 * bump makes the type pending again). Radix traps focus and hides the frame from assistive tech;
 * the layout also renders the frame `inert`, so it is unreachable before hydration. Server-side
 * `CONSENT_REQUIRED` still refuses every app call until the grants land.
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
  // Stays busy after success until the refreshed layout unmounts the gate (no second submit).
  const [accepted, setAccepted] = useState(false);
  const { alertRef } = useErrorFocus(undefined, error);

  const accept = useSubmit(async () => {
    setError(null);
    try {
      for (const type of pending) {
        const version = versions[type];
        if (!version) continue; // every pending type has a current version from the layout
        const { error: grantError } = await api.POST('/me/consents/{type}', {
          params: { path: { type } },
          body: { version },
        });
        if (grantError) {
          setError(apiErrorMessage(t, grantError as unknown));
          return;
        }
      }
    } catch {
      setError(t('errors.INTERNAL_ERROR'));
      return;
    }
    setAccepted(true);
    // Re-run the (app) layout server component: pendingConsents is now empty and the gate unmounts.
    router.refresh();
  });

  return (
    <Dialog.Root open>
      <Dialog.Content
        title={t('auth.consent.title')}
        description={t('auth.consent.intro')}
        closeLabel={t('common.close')}
        hideClose
        onEscapeKeyDown={keepOpen}
        onPointerDownOutside={keepOpen}
        onInteractOutside={keepOpen}
      >
        <ul className="flex flex-col divide-y divide-border">
          {pending.map((type) => {
            const row = CONSENT_ROWS[type];
            return (
              <li
                key={type}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{t(row.label)}</span>
                  <Badge variant="neutral">{versions[type]}</Badge>
                </span>
                <Link
                  href={row.href}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline"
                >
                  {t(row.read)}
                  <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
        {error ? (
          <Alert ref={alertRef} tabIndex={-1} variant="danger">
            {error}
          </Alert>
        ) : null}
        <Dialog.Footer>
          <Button
            variant="primary"
            loading={accept.busy || accepted}
            onClick={() => void accept.submit()}
          >
            {t('auth.consent.accept')}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
