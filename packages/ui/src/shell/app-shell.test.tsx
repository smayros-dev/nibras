import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayoutDashboard, Settings, Users } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { expectNoPhysicalClasses } from '../test/logical-classes';
import { renderWithDir, type Dir } from '../test/render';
import { AppShell } from './app-shell';
import type { NavSection, ShellLabels } from './nav';

const labels: ShellLabels = {
  skipToContent: 'Aller au contenu',
  primaryNav: 'Navigation principale',
  secondaryNav: 'Navigation rapide',
  more: 'Plus',
  closeMenu: 'Fermer le menu',
  brandHome: 'Accueil Plateforme cours',
};

const sections: NavSection[] = [
  {
    id: 'main',
    items: [
      {
        id: 'dashboard',
        href: '/fr/app',
        label: 'Dashboard',
        icon: LayoutDashboard,
        current: true,
      },
      {
        id: 'settings',
        href: '/fr/app/settings/profile',
        label: 'Paramètres',
        icon: <Settings />,
      },
    ],
  },
  {
    id: 'workspace',
    label: 'Espace de Mohamed',
    items: [{ id: 'members', href: '/fr/app/w/w1/members', label: 'Membres', icon: Users }],
  },
];

function renderShell(dir: Dir = 'ltr', extra = true) {
  return renderWithDir(
    <AppShell
      dir={dir}
      locale={dir === 'rtl' ? 'ar' : 'fr'}
      brand={{ name: 'Plateforme cours', href: '/fr/app' }}
      sections={sections}
      labels={labels}
      topBarStart={<span>Espace actuel</span>}
      topBarEnd={<button type="button">Menu utilisateur</button>}
      {...(extra ? { moreSheetExtra: <button type="button">Se déconnecter</button> } : {})}
    >
      <h1>Membres</h1>
    </AppShell>,
    { dir },
  );
}

describe('AppShell', () => {
  it('renders the primary nav landmark, a skip link first, the top bar and main', () => {
    renderShell();
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAccessibleName('Aller au contenu');
    expect(links[0]).toHaveAttribute('href', '#main');
    expect(screen.getByRole('banner')).toHaveTextContent('Espace actuel');
    expect(screen.getByRole('button', { name: 'Menu utilisateur' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(within(main).getByRole('heading', { level: 1 })).toHaveTextContent('Membres');
    expect(within(nav).getByRole('link', { name: 'Membres' })).toHaveAttribute(
      'href',
      '/fr/app/w/w1/members',
    );
  });

  it('adds no unnamed complementary landmark and clears the bottom nav plus the safe area', () => {
    renderShell();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByRole('main').className).toContain(
      'pb-[calc(6rem+env(safe-area-inset-bottom))]',
    );
    expect(screen.getByRole('main').className).toContain('lg:pb-8');
  });

  it('marks only the current item with aria-current="page"', () => {
    renderShell();
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Paramètres' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('labels a named section with a heading', () => {
    renderShell();
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getByRole('heading', { name: 'Espace de Mohamed' })).toBeInTheDocument();
  });

  it('links the brand home, named on the mark-only mobile link', () => {
    renderShell();
    expect(screen.getByRole('link', { name: 'Accueil Plateforme cours' })).toHaveAttribute(
      'href',
      '/fr/app',
    );
  });

  it('renders the bottom nav with More opening a sheet with the extra slot', async () => {
    const user = userEvent.setup();
    renderShell();
    const bottom = screen.getByRole('navigation', { name: 'Navigation rapide' });
    await user.click(within(bottom).getByRole('button', { name: 'Plus' }));
    const sheet = screen.getByRole('dialog', { name: 'Plus' });
    expect(within(sheet).getByRole('link', { name: 'Membres' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument();
  });

  it.each(['ltr', 'rtl'] as const)(
    'uses logical classes only (%s), including the open sheet',
    async (dir) => {
      const user = userEvent.setup();
      renderShell(dir);
      expect(document.querySelector('[lang]')).toHaveAttribute('dir', dir);
      await user.click(screen.getByRole('button', { name: 'Plus' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expectNoPhysicalClasses(document.body);
    },
  );
});
