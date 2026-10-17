import type { ReactNode } from 'react';
import type { NavSection } from './nav';
import { NavList } from './nav-list';

export interface ShellBrand {
  name: string;
  href: string;
  /** Logo mark; defaults to the first letter of `name` on the primary colour. */
  mark?: ReactNode;
}

export function BrandMark({ brand }: { brand: ShellBrand }) {
  return (
    <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center">
      {brand.mark ?? (
        <span className="inline-flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-fg">
          {brand.name.charAt(0)}
        </span>
      )}
    </span>
  );
}

export interface SidebarProps {
  brand: ShellBrand;
  sections: NavSection[];
  label: string;
}

/**
 * Desktop navigation at inline-start (`lg` and up): 72px icon rail below `xl`, 256px with labels
 * from `xl`. Hidden below `lg`, where the bottom nav takes over.
 */
export function Sidebar({ brand, sections, label }: SidebarProps) {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col gap-4 overflow-y-auto border-e border-border bg-surface p-3 lg:flex">
      <a
        href={brand.href}
        className="flex min-h-11 items-center gap-3 rounded-md px-2 font-semibold text-fg focus-visible:outline-2 focus-visible:outline-focus lg:justify-center xl:justify-start"
      >
        <BrandMark brand={brand} />
        <span className="truncate lg:sr-only xl:not-sr-only">{brand.name}</span>
      </a>
      <nav aria-label={label}>
        <NavList sections={sections} collapsible />
      </nav>
    </aside>
  );
}
