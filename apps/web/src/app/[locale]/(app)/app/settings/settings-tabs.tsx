'use client';

import { Badge, Tabs, useCurrentPath } from '@tt/ui';
import { useLocale, useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { localizedPath } from '../../../../../components/shell-path-provider';
import { usePathname } from '../../../../../i18n/navigation';

/** PRD §9.1 settings sections; only the live tabs link, the rest are *Bientôt* (kept visible). */
export const LIVE_TABS = ['profile', 'security', 'verification', 'consents', 'workspaces'] as const;
const SOON_TABS = ['notifications', 'organization', 'data'] as const;

/**
 * Settings sub-navigation: link tabs (each a real URL, `next/link` with the locale prefix like the
 * shell). The active tab follows the live path from `CurrentPathProvider` (the settings layout
 * stays mounted across tab changes, so it cannot come from server props).
 */
export function SettingsTabs() {
  const t = useTranslations();
  const locale = useLocale();
  const ownPath = localizedPath(locale, usePathname());
  const pathname = useCurrentPath() ?? ownPath;
  const base = `/${locale}/app/settings/`;
  const segment = pathname.startsWith(base)
    ? (pathname.slice(base.length).split('/')[0] ?? '')
    : '';

  return (
    <Tabs.Root asLinks value={segment}>
      <Tabs.List aria-label={t('settings.title')}>
        {LIVE_TABS.map((tab) => (
          <Tabs.Trigger key={tab} value={tab} asChild>
            <NextLink href={`${base}${tab}`}>{t(`settings.nav.${tab}`)}</NextLink>
          </Tabs.Trigger>
        ))}
        {SOON_TABS.map((tab) => (
          <Tabs.Trigger key={tab} value={tab} disabled>
            {t(`settings.nav.${tab}`)}
            <Badge variant="neutral">{t('settings.soon')}</Badge>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
