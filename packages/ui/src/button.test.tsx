import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { expectNoPhysicalClasses } from './test/logical-classes';
import { renderWithDir } from './test/render';

describe('Button', () => {
  it('renders a primary button with the label and type=button by default', () => {
    render(<Button variant="primary">Enregistrer</Button>);
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toHaveAttribute('type', 'button');
  });

  it('keeps an explicit type and forwards native props', () => {
    render(
      <Button variant="danger" size="sm" type="submit" disabled>
        Supprimer
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Supprimer' });
    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toBeDisabled();
  });

  it('loading state keeps the label, sets aria-busy and disables', () => {
    render(
      <Button variant="primary" loading>
        Enregistrer
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Enregistrer' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
    expect(b.querySelector('svg')).not.toBeNull();
  });

  it('is not busy by default', () => {
    render(<Button variant="ghost">x</Button>);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy');
  });

  it('renders every variant, with a 44 px minimum for md and icon', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'link'] as const) {
      render(<Button variant={variant}>{variant}</Button>);
    }
    expect(screen.getByRole('button', { name: 'primary' }).className).toContain('min-h-11');
    render(
      <Button variant="ghost" size="icon" aria-label="Menu">
        <svg />
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Menu' }).className).toContain('size-11');
  });

  it('asChild renders the child element with the button styles', () => {
    render(
      <Button variant="secondary" asChild iconStart={<svg data-testid="icon" />}>
        <a href="/app">Accueil</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Accueil' });
    expect(link).toHaveAttribute('href', '/app');
    expect(link).not.toHaveAttribute('type');
    expect(link.className).toContain('inline-flex');
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('forwards the ref', () => {
    let node: HTMLButtonElement | null = null;
    render(
      <Button
        variant="primary"
        ref={(el) => {
          node = el;
        }}
      >
        x
      </Button>,
    );
    expect(node).toBeInstanceOf(HTMLButtonElement);
  });

  it('uses only logical utilities', () => {
    const { container } = renderWithDir(
      <Button variant="secondary" loading iconStart={<svg />} iconEnd={<svg />}>
        x
      </Button>,
      { dir: 'rtl' },
    );
    expectNoPhysicalClasses(container);
  });
});
