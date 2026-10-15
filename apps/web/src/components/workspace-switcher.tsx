'use client';

import type { MyWorkspace } from '@tt/contracts';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '../i18n/navigation';

/**
 * PRD §9.1 *[Sélecteur d'espace ▾] (si plusieurs)*: shown only when the user belongs to more
 * than one workspace; the current one comes from the URL (`/app/w/[wid]`), else the first.
 */
export function WorkspaceSwitcher({ workspaces }: { workspaces: MyWorkspace[] }) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  if (workspaces.length <= 1) return null;
  const currentId = pathname.match(/^\/app\/w\/([^/]+)/)?.[1] ?? null;
  const current = workspaces.find((m) => m.workspace.id === currentId) ?? workspaces[0];

  return (
    <label className="ms-auto flex items-center gap-2 text-sm">
      <span className="sr-only">{t('workspace.switcherLabel')}</span>
      <select
        aria-label={t('workspace.switcherLabel')}
        value={current?.workspace.id ?? ''}
        onChange={(e) => router.push(`/app/w/${e.target.value}`)}
        className="rounded-md border border-gray-300 px-2 py-1"
      >
        {workspaces.map((m) => (
          <option key={m.workspace.id} value={m.workspace.id}>
            {m.workspace.name} —{' '}
            {m.workspace.type === 'ORGANIZATION'
              ? t('workspace.typeOrganization')
              : t('workspace.typePersonal')}
          </option>
        ))}
      </select>
    </label>
  );
}
