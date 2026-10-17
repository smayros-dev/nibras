import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './switch';
import { classTokens, expectNoPhysicalClasses } from './test/logical-classes';
import { renderWithDir } from './test/render';

describe('Switch', () => {
  it('toggles with Space and reports the new state', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="Notifications" checked={false} onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole('switch', { name: 'Notifications' });
    sw.focus();
    await userEvent.keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('reflects the controlled state', () => {
    render(<Switch label="Mode sombre" checked onCheckedChange={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Mode sombre' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('moves the thumb with a direction-aware transform and a 44 px hit area', () => {
    const { container } = renderWithDir(
      <Switch label="x" checked={false} onCheckedChange={() => {}} />,
      { dir: 'rtl' },
    );
    const tokens = classTokens(container);
    expect(tokens).toContain('data-[state=checked]:translate-x-5');
    expect(tokens).toContain('rtl:data-[state=checked]:-translate-x-5');
    expect(container.querySelector('label')?.className).toContain('min-h-11');
    expectNoPhysicalClasses(container);
  });
});
