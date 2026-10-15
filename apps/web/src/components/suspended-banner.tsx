'use client';

import { useTranslations } from 'next-intl';

/**
 * *Bannière d'espace suspendu* (plan Task 21): shown above workspace pages when the API reports
 * the workspace as SUSPENDED/DELETING. Mutations are refused server-side; this banner tells the
 * members the workspace is read-only. The suspension reason lives on the admin API only in SP1 —
 * members see this generic notice (exposing the reason to members is deferred past SP1).
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
