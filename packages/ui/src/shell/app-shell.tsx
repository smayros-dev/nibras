import type { ReactNode } from 'react';
import { BottomNav } from './bottom-nav';
import { NavCurrentScope } from './current-path';
import { navMatches, type NavSection, type ShellLabels } from './nav';
import { Sidebar, type ShellBrand } from './sidebar';
import { TopBar } from './top-bar';

export interface AppShellProps {
  dir: 'ltr' | 'rtl';
  locale: string;
  brand: ShellBrand;
  sections: NavSection[];
  labels: ShellLabels;
  /** Workspace switcher. */
  topBarStart?: ReactNode;
  /** Locale menu, theme toggle, user menu. */
  topBarEnd?: ReactNode;
  /** Locale, theme and logout in the mobile "More" sheet. */
  moreSheetExtra?: ReactNode;
  /**
   * Makes the whole frame (nav, top bar, main) inert while a blocking dialog rendered as a sibling
   * is open, e.g. the consent gate: no focus, no clicks, hidden from assistive tech, even before
   * the dialog's own script runs.
   */
  inert?: boolean;
  children: ReactNode;
}

/**
 * Page frame (PRD §9, spec §5): sidebar at inline-start from `lg` (icon rail until `xl`), sticky top
 * bar, `main#main`, and a bottom nav with a "More" sheet below `lg`. A server component: only the
 * sheet, the nav links and the path-scoped section gates are client-side. Inside a
 * `CurrentPathProvider` the current item (`aria-current`, longest match wins) and the scoped
 * sections follow the live path; without one, `NavItem.current` is used. Logical classes only, so
 * it mirrors through `dir`.
 */
export function AppShell({
  dir,
  locale,
  brand,
  sections,
  labels,
  topBarStart,
  topBarEnd,
  moreSheetExtra,
  inert = false,
  children,
}: AppShellProps) {
  return (
    <NavCurrentScope matches={navMatches(sections)}>
      <div
        lang={locale}
        dir={dir}
        inert={inert || undefined}
        className="min-h-dvh bg-bg text-fg lg:grid lg:grid-cols-[4.5rem_1fr] xl:grid-cols-[16rem_1fr]"
      >
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-[60] focus:rounded-md focus:bg-primary focus:p-3 focus:text-primary-fg"
        >
          {labels.skipToContent}
        </a>
        <Sidebar brand={brand} sections={sections} label={labels.primaryNav} />
        <div className="flex min-w-0 flex-col">
          <TopBar
            brand={brand}
            brandHomeLabel={labels.brandHome}
            start={topBarStart}
            end={topBarEnd}
          />
          <main
            id="main"
            tabIndex={-1}
            className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] focus:outline-none sm:px-6 lg:pb-8"
          >
            {children}
          </main>
        </div>
        <BottomNav sections={sections} labels={labels} moreSheetExtra={moreSheetExtra} />
      </div>
    </NavCurrentScope>
  );
}
