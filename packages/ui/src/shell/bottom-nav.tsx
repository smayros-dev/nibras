import type { ReactNode } from 'react';
import { cn } from '../cn';
import { MoreSheet } from './more-sheet';
import { renderNavIcon, type NavSection, type ShellLabels } from './nav';
import { NavList } from './nav-list';

/** Items of the first section shown in the bar; everything else goes to the "More" sheet. */
export const BOTTOM_NAV_MAX_ITEMS = 4;

export interface BottomNavProps {
  sections: NavSection[];
  labels: Pick<ShellLabels, 'secondaryNav' | 'more' | 'closeMenu'>;
  /** Extra sheet content (locale, theme, logout on mobile). */
  moreSheetExtra?: ReactNode;
}

const itemClasses = cn(
  'flex h-16 min-h-11 w-full flex-col items-center justify-center gap-1 px-1 text-xs font-medium text-fg-muted',
  'hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
  'aria-[current=page]:text-primary',
);

/** Mobile navigation (below `lg`): up to four items plus "More", above the safe-area inset. */
export function BottomNav({ sections, labels, moreSheetExtra }: BottomNavProps) {
  const [first, ...others] = sections;
  const shown = first?.items.slice(0, BOTTOM_NAV_MAX_ITEMS) ?? [];
  const overflow: NavSection[] = [
    ...(first && first.items.length > BOTTOM_NAV_MAX_ITEMS
      ? [{ ...first, items: first.items.slice(BOTTOM_NAV_MAX_ITEMS) }]
      : []),
    ...others,
  ].filter((section) => section.items.length > 0);
  const hasMore = overflow.length > 0 || (moreSheetExtra !== undefined && moreSheetExtra !== null);

  return (
    <nav
      aria-label={labels.secondaryNav}
      className="fixed start-0 end-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="grid auto-cols-fr grid-flow-col">
        {shown.map((item) => (
          <li key={item.id}>
            <a
              href={item.href}
              aria-current={item.current ? 'page' : undefined}
              className={itemClasses}
            >
              {renderNavIcon(item.icon)}
              <span className="max-w-full truncate">{item.label}</span>
            </a>
          </li>
        ))}
        {hasMore ? (
          <li>
            <MoreSheet labels={labels} triggerClassName={itemClasses}>
              <div className="flex flex-col gap-4">
                {overflow.length > 0 ? <NavList sections={overflow} headingLevel="h3" /> : null}
                {moreSheetExtra ? (
                  <div className="flex flex-col gap-2 border-t border-border pt-4">
                    {moreSheetExtra}
                  </div>
                ) : null}
              </div>
            </MoreSheet>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
