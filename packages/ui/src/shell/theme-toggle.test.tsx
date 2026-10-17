import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoPhysicalClasses } from '../test/logical-classes';
import { renderWithDir } from '../test/render';
import { ThemeToggle } from './theme-toggle';

const labels = {
  light: 'Clair',
  dark: 'Sombre',
  system: 'Système',
  toggle: 'Thème',
  toggleCurrent: (current: string) => `Thème : ${current}`,
};

describe('ThemeToggle', () => {
  it('opens with the keyboard and fires onValueChange("dark")', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderWithDir(<ThemeToggle value="light" onValueChange={onValueChange} labels={labels} />, {
      dir: 'rtl',
    });
    screen.getByRole('button', { name: 'Thème : Clair' }).focus();
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

  it('names the trigger with the current theme', () => {
    renderWithDir(<ThemeToggle value="system" onValueChange={() => {}} labels={labels} />);
    expect(screen.getByRole('button', { name: 'Thème : Système' })).toBeInTheDocument();
  });

  it('renders a stable Monitor placeholder while the theme is unknown (before mount)', () => {
    const { container } = renderWithDir(
      <ThemeToggle value={undefined} onValueChange={() => {}} labels={labels} />,
    );
    expect(screen.getByRole('button', { name: 'Thème' })).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveClass('lucide-monitor');
  });
});
