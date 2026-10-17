import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton, SkeletonTable, SkeletonText } from './skeleton';
import { expectNoPhysicalClasses } from './test/logical-classes';

describe('Skeleton', () => {
  it('is hidden from assistive tech and respects reduced motion', () => {
    const { container } = render(<Skeleton className="h-4 w-20" />);
    const el = container.firstElementChild!;
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el.className).toContain('animate-pulse');
    expect(el.className).toContain('motion-reduce:animate-none');
    expect(el.className).toContain('w-20');
  });

  it('renders the requested number of text lines (3 by default)', () => {
    const { container, rerender } = render(<SkeletonText />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild!.children).toHaveLength(3);
    rerender(<SkeletonText lines={4} />);
    expect(container.firstElementChild!.children).toHaveLength(4);
  });

  it('renders a rows x cols table placeholder', () => {
    const { container } = render(<SkeletonTable rows={2} cols={3} />);
    const root = container.firstElementChild!;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.children).toHaveLength(2);
    expect(root.children[0]!.children).toHaveLength(3);
    expectNoPhysicalClasses(container);
  });
});
