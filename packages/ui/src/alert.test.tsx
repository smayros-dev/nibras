import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert } from './alert';
import { expectNoPhysicalClasses } from './test/logical-classes';

describe('Alert', () => {
  it('announces danger alerts assertively with title and action', () => {
    render(
      <Alert variant="danger" title="Échec" action={<button type="button">Réessayer</button>}>
        Le serveur ne répond pas.
      </Alert>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Échec');
    expect(alert).toHaveTextContent('Le serveur ne répond pas.');
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('uses a polite status for the other variants', () => {
    for (const variant of ['info', 'success', 'warning'] as const) {
      const { unmount } = render(<Alert variant={variant}>{variant}</Alert>);
      expect(screen.getByRole('status')).toHaveTextContent(variant);
      expect(screen.queryByRole('alert')).toBeNull();
      unmount();
    }
  });

  it('uses only logical utilities', () => {
    const { container } = render(
      <Alert variant="warning" title="t" action={<span />}>
        x
      </Alert>,
    );
    expectNoPhysicalClasses(container);
  });
});
