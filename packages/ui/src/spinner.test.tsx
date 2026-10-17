import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from './spinner';
import { expectNoPhysicalClasses } from './test/logical-classes';

describe('Spinner', () => {
  it('is a status with the translated label passed by the caller', () => {
    render(<Spinner label="Loading" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('falls back to a French label', () => {
    const { container } = render(<Spinner size="lg" />);
    expect(screen.getByRole('status')).toHaveTextContent('Chargement');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expectNoPhysicalClasses(container);
  });
});
