import type { LucideIcon } from 'lucide-react';
import { createElement, isValidElement, type ReactNode } from 'react';
import type { NavMatch } from './current-path';

/** One destination of the shell navigation (labels already translated by the caller). */
export interface NavItem {
  id: string;
  href: string;
  label: string;
  /** A lucide icon component or an already rendered node (`null` for none). */
  icon: LucideIcon | ReactNode;
  /** Static current state, used only when no live path is provided (`CurrentPathProvider`). */
  current?: boolean;
  /** Path that makes the item current (and below it, unless `exact`); defaults to `href`. */
  match?: string;
  /** Unread or pending count shown next to the label. */
  badge?: number;
  /** Current only on an exact path match. Among matching items, the longest path wins. */
  exact?: boolean;
}

/** A group of items; the label (when present) is rendered as a section heading. */
export interface NavSection {
  id: string;
  label?: string;
  items: NavItem[];
  /** Rendered only while the live path is under this path (e.g. the current workspace's section). */
  visibleUnder?: string;
}

/** The serialisable match data of every item, for `NavCurrentScope`. */
export function navMatches(sections: readonly NavSection[]): NavMatch[] {
  return sections.flatMap((section) => section.items.map(navMatch));
}

/** The match data of one item, for `ShellNavLink`. */
export function navMatch(item: NavItem): NavMatch {
  return { id: item.id, path: item.match ?? item.href, ...(item.exact ? { exact: true } : {}) };
}

/** Translated by the caller. */
export interface ShellLabels {
  /** Skip link, the first focusable element. */
  skipToContent: string;
  /** Accessible name of the sidebar navigation landmark. */
  primaryNav: string;
  /** Accessible name of the mobile bottom navigation landmark. */
  secondaryNav: string;
  /** "More" button of the bottom nav and title of its sheet. */
  more: string;
  /** Close button of the "More" sheet. */
  closeMenu: string;
  /** Accessible name of the mark-only brand link in the mobile top bar. */
  brandHome: string;
}

function isIconComponent(icon: NavItem['icon']): icon is LucideIcon {
  if (isValidElement(icon)) return false;
  // Plain function components and forwardRef/memo objects (lucide icons are forwardRef objects).
  return (
    typeof icon === 'function' || (typeof icon === 'object' && icon !== null && '$$typeof' in icon)
  );
}

/**
 * Renders an item's icon as a decorative node. Components are rendered here (server side), so client
 * parts of the shell only ever receive serialisable nodes.
 */
export function renderNavIcon(icon: NavItem['icon'], className = 'size-5 shrink-0'): ReactNode {
  if (icon === null || icon === undefined || icon === false) return null;
  if (isIconComponent(icon)) return createElement(icon, { 'aria-hidden': true, className });
  return createElement(
    'span',
    { 'aria-hidden': true, className: `inline-flex ${className}` },
    icon,
  );
}
