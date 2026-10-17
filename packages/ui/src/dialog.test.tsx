import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { Dialog } from './dialog';
import { expectNoPhysicalClasses } from './test/logical-classes';
import { renderWithDir } from './test/render';

function Example({ hideTitle = false }: { hideTitle?: boolean }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button variant="primary">Ouvrir</Button>
      </Dialog.Trigger>
      <Dialog.Content
        title="Signaler un abus"
        description="Décrivez le problème"
        closeLabel="Fermer"
        hideTitle={hideTitle}
      >
        <input aria-label="Motif" />
        <Dialog.Footer>
          <Dialog.Close asChild>
            <Button variant="secondary">Annuler</Button>
          </Dialog.Close>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

describe('Dialog', () => {
  it('opens, traps focus, closes on Escape and restores focus', async () => {
    const user = userEvent.setup();
    renderWithDir(<Example />);
    const trigger = screen.getByRole('button', { name: 'Ouvrir' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 5; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('has an accessible name from title, a description and a labelled close button', async () => {
    const user = userEvent.setup();
    renderWithDir(<Example />);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    const dialog = screen.getByRole('dialog', { name: 'Signaler un abus' });
    expect(dialog).toHaveAccessibleDescription('Décrivez le problème');
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the accessible name when the title is visually hidden', async () => {
    const user = userEvent.setup();
    renderWithDir(<Example hideTitle />);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(screen.getByRole('dialog', { name: 'Signaler un abus' })).toBeInTheDocument();
  });

  it('uses only logical utilities in rtl', async () => {
    const user = userEvent.setup();
    renderWithDir(<Example />, { dir: 'rtl' });
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expectNoPhysicalClasses(document.body);
  });
});
