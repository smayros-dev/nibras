import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithDir } from '../test/render';
import { BottomNav } from './bottom-nav';
import type { NavSection } from './nav';

const labels = { secondaryNav: 'Navigation rapide', more: 'Plus', closeMenu: 'Fermer le menu' };

const main: NavSection = {
  id: 'main',
  items: ['Dashboard', 'Espaces', 'Paramètres', 'Cours', 'Messages'].map((label, i) => ({
    id: `i${i}`,
    href: `/fr/${i}`,
    label,
    icon: null,
    current: i === 1,
  })),
};
const admin: NavSection = {
  id: 'admin',
  label: 'Administration',
  items: [{ id: 'console', href: '/fr/admin', label: 'Console', icon: null }],
};

describe('BottomNav', () => {
  it('shows at most 4 items of the first section plus More', () => {
    renderWithDir(<BottomNav sections={[main, admin]} labels={labels} />);
    const nav = screen.getByRole('navigation', { name: 'Navigation rapide' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      'Dashboard',
      'Espaces',
      'Paramètres',
      'Cours',
    ]);
    expect(within(nav).getByRole('link', { name: 'Espaces' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const more = within(nav).getByRole('button', { name: 'Plus' });
    expect(more).toHaveAttribute('aria-haspopup', 'dialog');
    for (const el of [...links, more]) expect(el.className).toContain('min-h-11');
  });

  it('More opens a sheet listing the 5th item, the other sections and the extra slot', async () => {
    const user = userEvent.setup();
    renderWithDir(
      <BottomNav
        sections={[main, admin]}
        labels={labels}
        moreSheetExtra={<button type="button">Se déconnecter</button>}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Plus' }));
    const sheet = screen.getByRole('dialog', { name: 'Plus' });
    expect(within(sheet).getByRole('link', { name: 'Messages' })).toHaveAttribute('href', '/fr/4');
    expect(within(sheet).getByRole('link', { name: 'Console' })).toBeInTheDocument();
    expect(within(sheet).getByRole('heading', { name: 'Administration' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Fermer le menu' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('returns focus to the More trigger when the sheet closes', async () => {
    const user = userEvent.setup();
    renderWithDir(<BottomNav sections={[main, admin]} labels={labels} />);
    const more = screen.getByRole('button', { name: 'Plus' });
    await user.click(more);
    expect(screen.getByRole('dialog', { name: 'Plus' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(more).toHaveFocus();
    await user.click(more);
    await user.click(screen.getByRole('button', { name: 'Fermer le menu' }));
    expect(more).toHaveFocus();
  });

  it('hides More when everything fits and there is no extra content', () => {
    renderWithDir(
      <BottomNav sections={[{ id: 'main', items: main.items.slice(0, 3) }]} labels={labels} />,
    );
    expect(screen.queryByRole('button', { name: 'Plus' })).not.toBeInTheDocument();
  });
});
