import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoPhysicalClasses } from '../test/logical-classes';
import { renderWithDir } from '../test/render';
import { ThemeToggle } from './theme-toggle';

const labels = { light: 'Clair', dark: 'Sombre', system: 'Système', toggle: 'Thème' };

describe('ThemeToggle', () => {
  it('opens with the keyboard and fires onValueChange("dark")', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderWithDir(<ThemeToggle value="light" onValueChange={onValueChange} labels={labels} />, {
      dir: 'rtl',
    });
    screen.getByRole('button', { name: 'Thème' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitemradio', { name: 'Clair' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expectNoPhysicalClasses(document.body);
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Sombre' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('dark');
  });

  it('shows the icon of the current value', () => {
    const { container } = renderWithDir(
      <ThemeToggle value="system" onValueChange={() => {}} labels={labels} />,
    );
    expect(container.querySelector('svg')).toHaveClass('lucide-monitor');
  });
});
