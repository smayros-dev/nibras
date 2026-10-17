import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './select';
import { expectNoPhysicalClasses } from './test/logical-classes';
import { renderWithDir } from './test/render';

describe('Select', () => {
  it('is a native select that reports changes', async () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Pays" defaultValue="TN" onChange={(e) => onChange(e.target.value)}>
        <option value="TN">Tunisie</option>
        <option value="FR">France</option>
      </Select>,
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Pays' }), 'FR');
    expect(onChange).toHaveBeenCalledWith('FR');
  });

  it('reserves inline-end room for the chevron and hides it from assistive tech', () => {
    const { container } = render(
      <Select aria-label="Pays" invalid>
        <option>a</option>
      </Select>,
    );
    const select = screen.getByRole('combobox');
    expect(select.className).toContain('pe-9');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    const icon = container.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon?.getAttribute('class')).toContain('end-3');
  });

  it('uses only logical utilities in rtl', () => {
    const { container } = renderWithDir(
      <Select aria-label="x">
        <option>a</option>
      </Select>,
      { dir: 'rtl' },
    );
    expectNoPhysicalClasses(container);
  });
});
