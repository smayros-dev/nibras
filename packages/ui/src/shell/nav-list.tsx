import type { ReactNode } from 'react';
import { cn } from '../cn';
import { NavSectionGate, ShellNavLink } from './current-path';
import { navMatch, renderNavIcon, type NavItem, type NavSection } from './nav';

export interface NavListProps {
  sections: NavSection[];
  /** Section headings: `h2` in the sidebar, `h3` inside the "More" sheet (its title is the `h2`). */
  headingLevel?: 'h2' | 'h3';
  /** Icon-only between `lg` and `xl` (the collapsed sidebar); labels stay readable by AT. */
  collapsible?: boolean;
}

function NavLink({ item, collapsible }: { item: NavItem; collapsible: boolean }) {
  const textClasses = collapsible ? 'lg:sr-only xl:not-sr-only' : undefined;
  return (
    <ShellNavLink
      match={navMatch(item)}
      href={item.href}
      fallbackCurrent={item.current === true}
      className={cn(
        'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-fg-muted',
        'hover:bg-bg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-focus',
        'aria-[current=page]:bg-primary-subtle aria-[current=page]:text-primary',
        collapsible && 'lg:justify-center xl:justify-start',
      )}
    >
      {renderNavIcon(item.icon)}
      <span className={cn('truncate', textClasses)}>{item.label}</span>
      {item.badge ? (
        <span
          className={cn(
            'ms-auto inline-flex min-w-5 justify-center rounded-full bg-primary px-1.5 text-xs text-primary-fg tabular-nums',
            textClasses,
          )}
        >
          {item.badge}
        </span>
      ) : null}
    </ShellNavLink>
  );
}

/** A section scoped to a path (`visibleUnder`) is rendered only while the live path is under it. */
function Gate({ section, children }: { section: NavSection; children: ReactNode }) {
  return section.visibleUnder ? (
    <NavSectionGate path={section.visibleUnder}>{children}</NavSectionGate>
  ) : (
    children
  );
}

/** Sections of links separated by a rule, each with an optional heading (sidebar and sheet). */
export function NavList({ sections, headingLevel = 'h2', collapsible = false }: NavListProps) {
  const Heading = headingLevel;
  return (
    <div className="flex flex-col gap-3">
      {sections.map((section) => (
        <Gate key={section.id} section={section}>
          {/* A rule between rendered sections (a hidden scoped section leaves no stray rule). */}
          <div className="flex flex-col gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
            {section.label ? (
              <Heading
                className={cn(
                  'px-3 pb-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase',
                  collapsible && 'lg:sr-only xl:not-sr-only',
                )}
              >
                {section.label}
              </Heading>
            ) : null}
            <ul className="flex flex-col gap-1">
              {section.items.map((item) => (
                <li key={item.id}>
                  <NavLink item={item} collapsible={collapsible} />
                </li>
              ))}
            </ul>
          </div>
        </Gate>
      ))}
    </div>
  );
}
