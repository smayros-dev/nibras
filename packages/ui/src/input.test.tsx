import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input, TextInput } from './input';
import { expectNoPhysicalClasses } from './test/logical-classes';

describe('Input', () => {
  it('renders a text input that forwards native props and the ref', () => {
    let node: HTMLInputElement | null = null;
    render(
      <Input
        aria-label="Nom"
        defaultValue="Ali"
        ref={(el) => {
          node = el;
        }}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Nom' });
    expect(input).toHaveValue('Ali');
    expect(node).toBe(input);
  });

  it('marks itself invalid and keeps 16 px text (no iOS zoom)', () => {
    render(<Input aria-label="Nom" invalid />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.className).toContain('text-base');
  });

  it('keeps TextInput as a deprecated alias', () => {
    expect(TextInput).toBe(Input);
  });

  it('uses only logical utilities', () => {
    const { container } = render(<Input aria-label="x" invalid />);
    expectNoPhysicalClasses(container);
  });
});
