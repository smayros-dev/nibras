import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { PageHeader } from './page-header';
import { expectNoPhysicalClasses } from './test/logical-classes';
import { renderWithDir } from './test/render';

function Example() {
  return (
    <PageHeader
      title="Membres"
      description="Gérez les membres de l’espace."
      actions={<Button variant="primary">Inviter</Button>}
      breadcrumbs={{
        label: 'Fil d’Ariane',
        items: [
          <a key="w" href="/fr/app/w/1">
            Espace
          </a>,
          'Membres',
        ],
      }}
    />
  );
}

describe('PageHeader', () => {
  it('renders an h1 title, description and actions', () => {
    renderWithDir(<Example />);
    expect(screen.getByRole('heading', { level: 1, name: 'Membres' })).toBeInTheDocument();
    expect(screen.getByText('Gérez les membres de l’espace.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inviter' })).toBeInTheDocument();
  });

  it('renders the breadcrumb nav as an ordered list; the last item is the current page', () => {
    renderWithDir(<Example />);
    const nav = screen.getByRole('navigation', { name: 'Fil d’Ariane' });
    expect(nav.querySelector('ol')).not.toBeNull();
    expect(within(nav).getAllByRole('listitem')).toHaveLength(2);
    expect(within(nav).getByRole('link', { name: 'Espace' })).toBeInTheDocument();
    expect(within(nav).getByText('Membres')).toHaveAttribute('aria-current', 'page');
    // One separator chevron, decorative and mirrored in RTL.
    const chevrons = nav.querySelectorAll('svg');
    expect(chevrons).toHaveLength(1);
    expect(chevrons[0]).toHaveAttribute('aria-hidden', 'true');
    expect(chevrons[0]!.getAttribute('class')).toContain('rtl:-scale-x-100');
  });

  it('title level is configurable; no breadcrumbs means no nav', () => {
    renderWithDir(<PageHeader title="Profil" as="h2" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Profil' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('uses only logical utilities', () => {
    const { container } = renderWithDir(<Example />, { dir: 'rtl' });
    expectNoPhysicalClasses(container);
  });
});
