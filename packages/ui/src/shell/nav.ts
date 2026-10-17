import type { LucideIcon } from 'lucide-react';
import { createElement, isValidElement, type ReactNode } from 'react';

/** One destination of the shell navigation (labels already translated by the caller). */
export interface NavItem {
  id: string;
  href: string;
  label: string;
  /** A lucide icon component or an already rendered node (`null` for none). */
  icon: LucideIcon | ReactNode;
  current?: boolean;
  /** Unread or pending count shown next to the label. */
  badge?: number;
  /** For the web nav model: `current` only on an exact path match (not used for rendering). */
  exact?: boolean;
}

/** A group of items; the label (when present) is rendered as a section heading. */
export interface NavSection {
  id: string;
  label?: string;
  items: NavItem[];
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
