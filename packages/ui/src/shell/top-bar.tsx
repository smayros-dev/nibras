import type { ReactNode } from 'react';
import { BrandMark, type ShellBrand } from './sidebar';

export interface TopBarProps {
  brand: ShellBrand;
  /** Accessible name of the mark-only brand link (mobile). */
  brandHomeLabel: string;
  start?: ReactNode;
  end?: ReactNode;
}

/** Sticky 56px header: brand mark below `lg`, then the start slot (workspace) and end slot (menus). */
export function TopBar({ brand, brandHomeLabel, start, end }: TopBarProps) {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur sm:px-6">
      <a
        href={brand.href}
        aria-label={brandHomeLabel}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-focus lg:hidden"
      >
        <BrandMark brand={brand} />
      </a>
      <div className="flex min-w-0 flex-1 items-center">{start}</div>
      {end ? <div className="flex shrink-0 items-center gap-1">{end}</div> : null}
    </header>
  );
}
