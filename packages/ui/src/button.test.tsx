import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

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
});
