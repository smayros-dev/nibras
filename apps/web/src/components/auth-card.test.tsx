import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthLoading } from './auth-card';

describe('AuthLoading', () => {
  it('keeps a page h1 (visually hidden) next to the loading status', () => {
    render(<AuthLoading title="Vérification en deux étapes" label="Chargement…" />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Vérification en deux étapes' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Chargement…');
  });
});
