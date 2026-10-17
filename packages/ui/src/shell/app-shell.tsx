import type { ReactNode } from 'react';
import { BottomNav } from './bottom-nav';
import type { NavSection, ShellLabels } from './nav';
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
  children: ReactNode;
}

/**
 * Page frame (PRD §9, spec §5): sidebar at inline-start from `lg` (icon rail until `xl`), sticky top
 * bar, `main#main`, and a bottom nav with a "More" sheet below `lg`. A server component: only the
 * sheet is client-side. Logical classes only, so it mirrors through `dir`.
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
  children,
}: AppShellProps) {
  return (
    <div
      lang={locale}
      dir={dir}
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
          className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 focus:outline-none sm:px-6 lg:pb-8"
        >
          {children}
        </main>
      </div>
      <BottomNav sections={sections} labels={labels} moreSheetExtra={moreSheetExtra} />
    </div>
  );
}
