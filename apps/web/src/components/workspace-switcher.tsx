'use client';

import type { MyWorkspace } from '@tt/contracts';
import { Badge, DropdownMenu, VisuallyHidden } from '@tt/ui';
import { ChevronDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from '../i18n/navigation';
import { hardNavigate } from '../lib/hard-navigate';
import { workspaceIdFromPath } from '../lib/navigation';

/**
 * PRD §9.1 *[Sélecteur d'espace ▾]*: the current workspace (from the URL `/app/w/[wid]`, else the
 * first) with its type badge; the menu lists every workspace and navigates to the chosen one (a
 * full navigation, so the layout's nav model follows; see `hardNavigate`).
 * The trigger is named "Espace actuel <name> <type>" (visible text included, WCAG 2.5.3).
 */
export function WorkspaceSwitcher({ workspaces }: { workspaces: MyWorkspace[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  if (workspaces.length === 0) return null;
  const currentId = workspaceIdFromPath(pathname);
  const current = workspaces.find((m) => m.workspace.id === currentId) ?? workspaces[0]!;
  const typeLabel = (m: MyWorkspace) =>
    m.workspace.type === 'ORGANIZATION'
      ? t('workspace.typeOrganization')
      : t('workspace.typePersonal');

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="inline-flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-md px-2 text-sm font-medium text-fg hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-focus">
        <VisuallyHidden>{t('nav.currentWorkspace')}</VisuallyHidden>
        <span className="truncate">{current.workspace.name}</span>
        <Badge
          variant={current.workspace.type === 'ORGANIZATION' ? 'brand' : 'neutral'}
          className="hidden sm:inline-flex"
        >
          {typeLabel(current)}
        </Badge>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" className="w-72">
        <DropdownMenu.Label>{t('workspace.switcherLabel')}</DropdownMenu.Label>
        <DropdownMenu.RadioGroup
          value={currentId ?? ''}
          onValueChange={(wid) => hardNavigate(`/${locale}/app/w/${encodeURIComponent(wid)}`)}
        >
          {workspaces.map((m) => (
            <DropdownMenu.RadioItem key={m.workspace.id} value={m.workspace.id}>
              <span className="min-w-0 flex-1 truncate">{m.workspace.name}</span>
              <Badge variant={m.workspace.type === 'ORGANIZATION' ? 'brand' : 'neutral'}>
                {typeLabel(m)}
              </Badge>
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
