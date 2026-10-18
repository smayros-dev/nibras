'use client';

import { Tabs, useCurrentPath } from '@nibras/ui';
import { useLocale, useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { localizedPath } from '../../../../../../components/shell-path-provider';
import { usePathname } from '../../../../../../i18n/navigation';

const TABS = [
  { value: 'settings', segment: '', label: 'workspace.navSettings' },
  { value: 'members', segment: '/members', label: 'workspace.navMembers' },
  { value: 'audit-log', segment: '/audit-log', label: 'workspace.navAudit' },
] as const;

/**
 * Workspace sub-navigation (PRD §9.2): link tabs Paramètres · Membres · Journal, each a real URL
 * (`next/link` with the locale prefix, like the shell). The active tab follows the live path from
 * `CurrentPathProvider` (the workspace layout stays mounted across tab changes); the sidebar's
 * workspace section marks the same page.
 */
export function WorkspaceTabs({ wid, label }: { wid: string; label: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const ownPath = localizedPath(locale, usePathname());
  const pathname = useCurrentPath() ?? ownPath;
  const base = `/${locale}/app/w/${wid}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : '';
  const segment = rest.split('/')[1] ?? '';
  const value = segment === '' ? 'settings' : segment;

  return (
    <Tabs.Root asLinks value={value}>
      <Tabs.List aria-label={label}>
        {TABS.map((tab) => (
          <Tabs.Trigger key={tab.value} value={tab.value} asChild>
            <NextLink href={`${base}${tab.segment}`}>{t(tab.label)}</NextLink>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
