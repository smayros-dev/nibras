import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './badge';
import { expectNoPhysicalClasses } from './test/logical-classes';

describe('Badge', () => {
  it('renders each variant with semantic colours', () => {
    const variants = ['neutral', 'brand', 'success', 'warning', 'danger', 'info'] as const;
    const { container } = render(
      <>
        {variants.map((v) => (
          <Badge key={v} variant={v}>
            {v}
          </Badge>
        ))}
      </>,
    );
    expect(screen.getByText('danger').className).toContain('text-danger');
    expect(screen.getByText('brand').className).toContain('text-primary');
    expectNoPhysicalClasses(container);
  });
});
