import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VisuallyHidden } from './visually-hidden';

describe('VisuallyHidden', () => {
  it('keeps the text in the accessibility tree', () => {
    render(
      <button type="button">
        <svg aria-hidden="true" />
        <VisuallyHidden>Fermer</VisuallyHidden>
      </button>,
    );
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
  });
});
