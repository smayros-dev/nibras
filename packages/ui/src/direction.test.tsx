import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DirectionProvider, useDirection } from './direction';

function Probe() {
  return <span>{useDirection()}</span>;
}

describe('DirectionProvider', () => {
  it('provides the direction to Radix consumers', () => {
    render(
      <DirectionProvider dir="rtl">
        <Probe />
      </DirectionProvider>,
    );
    expect(screen.getByText('rtl')).toBeInTheDocument();
  });

  it('defaults to ltr without a provider', () => {
    render(<Probe />);
    expect(screen.getByText('ltr')).toBeInTheDocument();
  });
});
