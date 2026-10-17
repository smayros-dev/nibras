'use client';

import { CurrentPathProvider } from '@tt/ui';
import { useLocale } from 'next-intl';
import NextLink from 'next/link';
import type { ReactNode } from 'react';
import { usePathname } from '../i18n/navigation';

/** `/app` + `fr` -> `/fr/app`: the form of the nav `href`s (already locale-prefixed). */
export function localizedPath(locale: string, pathname: string): string {
  return `/${locale}${pathname === '/' ? '' : pathname}`;
}

/**
 * Gives the shell the live path and `next/link`, so the nav's current item and the workspace
 * section follow client navigations (the `(app)`/`(admin)` layout, which builds the nav model,
 * stays mounted). `next/link` rather than the next-intl `Link`: the nav `href`s already carry the
 * locale.
 */
export function ShellPathProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const pathname = usePathname();
  return (
    <CurrentPathProvider pathname={localizedPath(locale, pathname)} linkComponent={NextLink}>
      {children}
    </CurrentPathProvider>
  );
}
