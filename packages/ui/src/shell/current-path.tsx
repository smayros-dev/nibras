'use client';

import {
  createContext,
  useContext,
  useMemo,
  type AnchorHTMLAttributes,
  type ComponentType,
  type ReactNode,
} from 'react';

/** The anchor the shell renders its links with (the app passes its router `Link`). */
export type ShellLinkComponent = ComponentType<
  AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
>;

interface CurrentPathValue {
  pathname: string | null;
  Link: ShellLinkComponent | 'a';
}

const CurrentPathContext = createContext<CurrentPathValue>({ pathname: null, Link: 'a' });

export interface CurrentPathProviderProps {
  /** The current path in the same form as the nav `href`s (locale-prefixed in the web app). */
  pathname: string;
  /** Client-side navigation link (`next/link`); plain anchors without one. */
  linkComponent?: ShellLinkComponent;
  children: ReactNode;
}

/**
 * Feeds the shell the live path, so `aria-current` and the path-scoped sections follow client
 * navigations (shared layouts stay mounted, their server props would go stale). The app fills it
 * from its router (`usePathname()`); the ui package stays router-agnostic.
 */
export function CurrentPathProvider({
  pathname,
  linkComponent,
  children,
}: CurrentPathProviderProps) {
  const value = useMemo(
    () => ({ pathname, Link: linkComponent ?? ('a' as const) }),
    [pathname, linkComponent],
  );
  return <CurrentPathContext.Provider value={value}>{children}</CurrentPathContext.Provider>;
}

/** The path from the nearest `CurrentPathProvider` (`null` without one). */
export function useCurrentPath(): string | null {
  return useContext(CurrentPathContext).pathname;
}

function normalizePath(path: string): string {
  const bare = path.replace(/[?#].*$/, '');
  return bare.length > 1 ? bare.replace(/\/+$/, '') : bare || '/';
}

/** `path` itself, or (unless `exact`) any path below it; a query or hash is ignored. */
export function matchesNavPath(pathname: string, path: string, exact = false): boolean {
  const current = normalizePath(pathname);
  const target = normalizePath(path);
  if (exact) return current === target;
  return current === target || current.startsWith(`${target}/`);
}

/** What decides whether an item is current: its `match` path (else `href`) and `exact`. */
export interface NavMatch {
  id: string;
  path: string;
  exact?: boolean;
}

/** The current item: among those matching `pathname`, the one with the longest path. */
export function currentNavId(matches: readonly NavMatch[], pathname: string): string | null {
  let best: NavMatch | null = null;
  for (const match of matches) {
    if (!matchesNavPath(pathname, match.path, match.exact === true)) continue;
    if (!best || normalizePath(match.path).length > normalizePath(best.path).length) best = match;
  }
  return best?.id ?? null;
}

/** `undefined` outside a scope (a standalone nav list): each link then matches on its own. */
const NavScopeContext = createContext<readonly NavMatch[] | undefined>(undefined);

/** Every item of the shell, so a single item is current (longest match wins). */
export function NavCurrentScope({
  matches,
  children,
}: {
  matches: readonly NavMatch[];
  children: ReactNode;
}) {
  return <NavScopeContext.Provider value={matches}>{children}</NavScopeContext.Provider>;
}

export interface ShellNavLinkProps {
  match: NavMatch;
  href: string;
  /** Used when no path is provided (no `CurrentPathProvider`). */
  fallbackCurrent?: boolean;
  className?: string;
  children: ReactNode;
}

/** A nav link whose `aria-current` follows the live path. */
export function ShellNavLink({
  match,
  href,
  fallbackCurrent = false,
  className,
  children,
}: ShellNavLinkProps) {
  const { pathname, Link } = useContext(CurrentPathContext);
  const scope = useContext(NavScopeContext);
  let current = fallbackCurrent;
  if (pathname !== null) {
    current = scope
      ? currentNavId(scope, pathname) === match.id
      : matchesNavPath(pathname, match.path, match.exact === true);
  }
  return (
    <Link href={href} aria-current={current ? 'page' : undefined} className={className}>
      {children}
    </Link>
  );
}

/** Renders a path-scoped section only while the live path is under `path` (always without one). */
export function NavSectionGate({ path, children }: { path: string; children: ReactNode }) {
  const pathname = useCurrentPath();
  if (pathname !== null && !matchesNavPath(pathname, path)) return null;
  return <>{children}</>;
}
