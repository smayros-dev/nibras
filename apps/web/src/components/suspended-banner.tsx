'use client';

import { useTranslations } from 'next-intl';

/**
 * *Bannière d'espace suspendu* (plan Task 21): shown above workspace pages when the API reports
 * the workspace as SUSPENDED/DELETING. Mutations are refused server-side; this banner tells the
 * members why the workspace is read-only. The reason string lives on the admin API only in SP1
 * (see plan deviation logged in the ledger); the copy here is the generic suspension notice.
 */
export function SuspendedBanner({ status }: { status: 'SUSPENDED' | 'DELETING' }) {
  const t = useTranslations();
  return (
    <p
      role="status"
      className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm font-semibold text-warning"
      data-status={status}
    >
      {t('workspace.suspended')}
    </p>
  );
}
