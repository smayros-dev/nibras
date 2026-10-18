import type { MyWorkspace } from '@nibras/contracts';
import { screen, within } from '@testing-library/react';
import { AppShell } from '@nibras/ui';
import type { AnchorHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { buildNavModel } from '../lib/navigation';
import { mockRouter, renderWithIntl } from '../test/render';
import { localizedPath, ShellPathProvider } from './shell-path-provider';

vi.mock('next/link', () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a data-next-link="" {...props} />
  ),
}));

const w1 = {
  workspace: { id: 'w1', name: 'Espace de Mohamed', slug: 'm', type: 'PERSONAL', status: 'ACTIVE' },
  role: 'OWNER',
} as MyWorkspace;

const sections = buildNavModel({
  t: (key) => key,
  user: { platformRole: 'NONE' },
  workspaces: [w1],
  locale: 'fr',
});

function frame() {
  return (
    <ShellPathProvider>
      <AppShell
        dir="ltr"
        locale="fr"
        brand={{ name: 'Nibras', href: '/fr/app' }}
        sections={sections}
        labels={{
          skipToContent: 'skip',
          primaryNav: 'primary',
          secondaryNav: 'secondary',
          more: 'more',
          closeMenu: 'close',
          brandHome: 'home',
        }}
      >
        <p>page</p>
      </AppShell>
    </ShellPathProvider>
  );
}

const current = () =>
  within(screen.getByRole('navigation', { name: 'primary' }))
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent);

describe('ShellPathProvider', () => {
  it('prefixes the locale-less path with the locale', () => {
    expect(localizedPath('fr', '/app/settings')).toBe('/fr/app/settings');
    expect(localizedPath('ar', '/')).toBe('/ar');
  });

  it('follows client navigations: current item and workspace section from the live path', () => {
    mockRouter({ pathname: '/app/settings/profile' });
    const { rerender } = renderWithIntl(frame());
    expect(current()).toEqual(['nav.settings']);
    expect(screen.queryByRole('heading', { name: 'Espace de Mohamed' })).not.toBeInTheDocument();

    // Same mounted layout, new path (as after a `<Link>` click).
    mockRouter({ pathname: '/app/settings/workspaces' });
    rerender(frame());
    expect(current()).toEqual(['nav.workspaces']);

    mockRouter({ pathname: '/app/w/w1/members' });
    rerender(frame());
    expect(current()).toEqual(['workspace.navMembers']);
    expect(screen.getAllByRole('heading', { name: 'Espace de Mohamed' }).length).toBeGreaterThan(0);
  });

  it('renders the nav with next/link', () => {
    mockRouter({ pathname: '/app' });
    renderWithIntl(frame());
    const nav = screen.getByRole('navigation', { name: 'primary' });
    expect(within(nav).getByRole('link', { name: 'nav.dashboard' })).toHaveAttribute(
      'data-next-link',
    );
  });
});
