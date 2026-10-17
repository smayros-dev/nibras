import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Trash2 } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';
import { DropdownMenu } from './dropdown-menu';
import { expectNoPhysicalClasses } from './test/logical-classes';
import { renderWithDir } from './test/render';

function Example({
  onSelect,
  onLocale,
}: {
  onSelect: () => void;
  onLocale?: (value: string) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost">Actions</Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Label>Compte</DropdownMenu.Label>
        <DropdownMenu.Item onSelect={onSelect}>Profil</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.RadioGroup value="fr" onValueChange={onLocale}>
          <DropdownMenu.RadioItem value="fr">Français</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="ar">العربية</DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
        <DropdownMenu.CheckboxItem checked>Compact</DropdownMenu.CheckboxItem>
        <DropdownMenu.Item destructive icon={<Trash2 />}>
          Retirer
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

describe('DropdownMenu', () => {
  it('opens with ArrowDown and moves between items in rtl', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithDir(<Example onSelect={onSelect} />, { dir: 'rtl' });
    screen.getByRole('button', { name: 'Actions' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('menuitem', { name: 'Profil' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Français' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{Enter}');
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('exposes radio and checkbox items with their state', async () => {
    const user = userEvent.setup();
    const onLocale = vi.fn();
    renderWithDir(<Example onSelect={() => {}} onLocale={onLocale} />);
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('menuitemradio', { name: 'Français' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Compact' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(screen.getByRole('menuitemradio', { name: 'العربية' }));
    expect(onLocale).toHaveBeenCalledWith('ar');
  });

  it('styles destructive items with danger tokens and logical classes only', async () => {
    const user = userEvent.setup();
    renderWithDir(<Example onSelect={() => {}} />, { dir: 'rtl' });
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('menuitem', { name: 'Retirer' }).className).toContain('text-danger');
    expectNoPhysicalClasses(document.body);
  });
});
