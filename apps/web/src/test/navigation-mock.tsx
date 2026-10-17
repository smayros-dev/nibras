import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { vi } from 'vitest';

/** The router the mocked `useRouter()` returns (locale-aware API of `src/i18n/navigation.ts`). */
export interface MockRouter {
  push: ReturnType<typeof vi.fn>;
  replace: ReturnType<typeof vi.fn>;
  back: ReturnType<typeof vi.fn>;
  forward: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  prefetch: ReturnType<typeof vi.fn>;
}

const state: { router: MockRouter; pathname: string } = {
  router: freshRouter(),
  pathname: '/',
};

function freshRouter(): MockRouter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  };
}

/**
 * Resets the mocked locale-aware router and returns it, so a test can assert navigations:
 * `const router = mockRouter({ pathname: '/app' }); …; expect(router.push).toHaveBeenCalledWith('/login')`.
 * Pathnames are locale-less, as `usePathname()` from next-intl returns them.
 */
export function mockRouter({ pathname = '/' }: { pathname?: string } = {}): MockRouter {
  state.router = freshRouter();
  state.pathname = pathname;
  return state.router;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | { pathname: string };
  locale?: string;
  children?: ReactNode;
};

/** Module factory for `vi.mock('../i18n/navigation', …)`, installed globally by `setup.ts`. */
export function navigationModuleMock() {
  return {
    useRouter: () => state.router,
    usePathname: () => state.pathname,
    Link: ({ href, locale: _locale, children, ...rest }: LinkProps) => (
      <a href={typeof href === 'string' ? href : href.pathname} {...rest}>
        {children}
      </a>
    ),
  };
}
