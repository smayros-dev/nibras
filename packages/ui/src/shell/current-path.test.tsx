import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes } from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithDir } from '../test/render';
import { AppShell } from './app-shell';
import { CurrentPathProvider, currentNavId, matchesNavPath } from './current-path';
import type { NavSection, ShellLabels } from './nav';

const labels: ShellLabels = {
  skipToContent: 'Aller au contenu',
  primaryNav: 'Navigation principale',
  secondaryNav: 'Navigation rapide',
  more: 'Plus',
  closeMenu: 'Fermer le menu',
  brandHome: 'Accueil',
};

const sections: NavSection[] = [
  {
    id: 'main',
    items: [
      { id: 'dashboard', href: '/fr/app', label: 'Dashboard', icon: null, exact: true },
      { id: 'workspaces', href: '/fr/app/settings/workspaces', label: 'Espaces', icon: null },
      {
        id: 'settings',
        href: '/fr/app/settings/profile',
        match: '/fr/app/settings',
        label: 'Paramètres',
        icon: null,
        // Ignored once a live path is provided.
        current: true,
      },
    ],
  },
  {
    id: 'workspace-w1',
    label: 'Espace de Mohamed',
    visibleUnder: '/fr/app/w/w1',
    items: [{ id: 'w1-members', href: '/fr/app/w/w1/members', label: 'Membres', icon: null }],
  },
];

function TestLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a data-router-link="" {...props} />;
}

function shell(pathname: string) {
  return (
    <CurrentPathProvider pathname={pathname} linkComponent={TestLink}>
      <AppShell
        dir="ltr"
        locale="fr"
        brand={{ name: 'Plateforme', href: '/fr/app' }}
        sections={sections}
        labels={labels}
      >
        <p>contenu</p>
      </AppShell>
    </CurrentPathProvider>
  );
}

const primary = () => screen.getByRole('navigation', { name: 'Navigation principale' });
const currentNames = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent);

describe('matchesNavPath / currentNavId', () => {
  it('matches the path and below, exact only when asked, ignoring query and trailing slash', () => {
    expect(matchesNavPath('/fr/app/settings/security?x=1', '/fr/app/settings')).toBe(true);
    expect(matchesNavPath('/fr/app/settingsx', '/fr/app/settings')).toBe(false);
    expect(matchesNavPath('/fr/app/', '/fr/app', true)).toBe(true);
    expect(matchesNavPath('/fr/app/w', '/fr/app', true)).toBe(false);
  });

  it('picks the longest matching path', () => {
    const matches = [
      { id: 'settings', path: '/fr/app/settings' },
      { id: 'workspaces', path: '/fr/app/settings/workspaces' },
    ];
    expect(currentNavId(matches, '/fr/app/settings/workspaces')).toBe('workspaces');
    expect(currentNavId(matches, '/fr/app/settings/consents')).toBe('settings');
    expect(currentNavId(matches, '/fr/admin')).toBeNull();
  });
});

describe('AppShell inside CurrentPathProvider', () => {
  it('moves aria-current when the path changes, in the sidebar and the bottom nav', () => {
    const { rerender } = renderWithDir(shell('/fr/app/settings/profile'));
    expect(currentNames(primary())).toEqual(['Paramètres']);

    rerender(shell('/fr/app/settings/workspaces'));
    expect(currentNames(primary())).toEqual(['Espaces']);
    const bottom = screen.getByRole('navigation', { name: 'Navigation rapide' });
    expect(currentNames(bottom)).toEqual(['Espaces']);

    rerender(shell('/fr/app'));
    expect(currentNames(primary())).toEqual(['Dashboard']);
  });

  it('shows a path-scoped section only under its path and marks its item', async () => {
    const { rerender } = renderWithDir(shell('/fr/app'));
    expect(within(primary()).queryByRole('link', { name: 'Membres' })).not.toBeInTheDocument();

    rerender(shell('/fr/app/w/w1/members'));
    expect(within(primary()).getByRole('heading', { name: 'Espace de Mohamed' })).toBeVisible();
    expect(currentNames(primary())).toEqual(['Membres']);

    // The "More" sheet derives the same state.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Plus' }));
    const sheet = screen.getByRole('dialog', { name: 'Plus' });
    expect(within(sheet).getByRole('link', { name: 'Membres' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('renders the links with the provided link component', () => {
    renderWithDir(shell('/fr/app'));
    expect(within(primary()).getByRole('link', { name: 'Espaces' })).toHaveAttribute(
      'data-router-link',
    );
  });
});
