import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './checkbox';
import { expectNoPhysicalClasses } from './test/logical-classes';
import { renderWithDir } from './test/render';

describe('Checkbox', () => {
  it('is named by its label and toggles on label click', async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Se souvenir de moi" onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole('checkbox', { name: 'Se souvenir de moi' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(screen.getByText('Se souvenir de moi'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(box).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles with Space', async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Accepter" onCheckedChange={onCheckedChange} />);
    screen.getByRole('checkbox').focus();
    await userEvent.keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('keeps the SP1 controlled onChange(e.target.checked) contract', async () => {
    function Controlled() {
      const [checked, setChecked] = useState(false);
      return (
        <Checkbox label="CGU" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
      );
    }
    render(<Controlled />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'CGU' }));
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  });

  it('wires the description and a 44 px hit area', () => {
    const { container } = render(<Checkbox label="A" description="Détail" />);
    const box = screen.getByRole('checkbox', { name: 'A' });
    expect(box).toHaveAccessibleDescription('Détail');
    expect(container.querySelector('label')?.className).toContain('min-h-11');
  });

  it('uses only logical utilities', () => {
    const { container } = renderWithDir(<Checkbox label="A" defaultChecked />, { dir: 'rtl' });
    expectNoPhysicalClasses(container);
  });
});
