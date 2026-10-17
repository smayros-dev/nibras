import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Textarea } from './textarea';
import { expectNoPhysicalClasses } from './test/logical-classes';

describe('Textarea', () => {
  it('defaults to 3 rows and forwards props', () => {
    render(<Textarea aria-label="Message" placeholder="..." />);
    const area = screen.getByRole('textbox', { name: 'Message' });
    expect(area.tagName).toBe('TEXTAREA');
    expect(area).toHaveAttribute('rows', '3');
  });

  it('grows with its content when autoResize is set (CSS field-sizing, no inline style)', () => {
    render(<Textarea aria-label="Message" autoResize invalid />);
    const area = screen.getByRole('textbox');
    expect(area.className).toContain('field-sizing-content');
    expect(area).not.toHaveAttribute('style');
    expect(area).toHaveAttribute('aria-invalid', 'true');
  });

  it('uses only logical utilities', () => {
    const { container } = render(<Textarea aria-label="x" autoResize />);
    expectNoPhysicalClasses(container);
  });
});
