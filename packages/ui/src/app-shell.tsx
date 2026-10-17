import type { ReactNode } from 'react';

export interface NavItem {
  href: string;
  /** Already translated label (from the `nav.*` messages). */
  label: string;
  current?: boolean;
}

export interface AppShellLabels {
  /** e.g. "Aller au contenu" — skip link, first focusable element. */
  skipToContent: string;
  /** e.g. "Navigation principale" — accessible name of the primary nav landmark. */
  primaryNav: string;
}

export interface AppShellProps {
  locale: string;
  dir: 'ltr' | 'rtl';
  nav: NavItem[];
  labels: AppShellLabels;
  /** Extra header content (e.g. the workspace switcher), rendered after the primary nav. */
  headerSlot?: ReactNode;
  children: ReactNode;
}

/**
 * Page frame: top navigation + main content. Layout uses logical properties only (flex, gap,
 * `padding-inline`), so it mirrors through the `dir` attribute — never through left/right classes.
 */
export function AppShell({ locale, dir, nav, labels, headerSlot, children }: AppShellProps) {
  return (
    <div lang={locale} dir={dir} className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:p-2 focus:bg-brand-700 focus:text-white"
      >
        {labels.skipToContent}
      </a>
      <header className="flex flex-wrap items-center gap-4 border-b border-brand-100 py-3">
        <nav aria-label={labels.primaryNav}>
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {nav.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  aria-current={item.current ? 'page' : undefined}
                  className="text-brand-700 hover:underline aria-[current=page]:font-semibold"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {headerSlot}
      </header>
      <main id="main" tabIndex={-1} className="flex-1 py-6">
        {children}
      </main>
    </div>
  );
}
