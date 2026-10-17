import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AlertDialog } from './alert-dialog';
import { Button } from './button';
import { expectNoPhysicalClasses } from './test/logical-classes';
import { renderWithDir } from './test/render';

function Example({ onConfirm }: { onConfirm: () => void }) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <Button variant="danger">Retirer</Button>
      </AlertDialog.Trigger>
      <AlertDialog.Content title="Retirer ce membre ?" description="Cette action est définitive.">
        <AlertDialog.Footer>
          <AlertDialog.Cancel>Annuler</AlertDialog.Cancel>
          <AlertDialog.Action destructive onClick={onConfirm}>
            Confirmer
          </AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

describe('AlertDialog', () => {
  it('is an alertdialog named by its title, focusing Cancel first', async () => {
    const user = userEvent.setup();
    renderWithDir(<Example onConfirm={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Retirer' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Retirer ce membre ?' });
    expect(dialog).toHaveAccessibleDescription('Cette action est définitive.');
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toHaveFocus();
  });

  it('confirms with the destructive action and closes', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithDir(<Example onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Retirer' }));
    const action = screen.getByRole('button', { name: 'Confirmer' });
    expect(action.className).toContain('bg-danger');
    await user.click(action);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('cancels with Escape without confirming, logical classes only', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithDir(<Example onConfirm={onConfirm} />, { dir: 'rtl' });
    await user.click(screen.getByRole('button', { name: 'Retirer' }));
    expectNoPhysicalClasses(document.body);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('ignores a click outside it', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithDir(<Example onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Retirer' }));
    const overlay = document.querySelector('.bg-overlay');
    expect(overlay).not.toBeNull();
    await user.click(overlay as HTMLElement);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
