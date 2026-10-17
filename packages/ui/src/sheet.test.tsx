import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { Sheet, type SheetSide } from './sheet';
import { classTokens, expectNoPhysicalClasses } from './test/logical-classes';
import { renderWithDir } from './test/render';

function Example({ side }: { side: SheetSide }) {
  return (
    <Sheet.Root>
      <Sheet.Trigger asChild>
        <Button variant="ghost">Plus</Button>
      </Sheet.Trigger>
      <Sheet.Content side={side} title="Menu" closeLabel="Fermer">
        <a href="/app">Tableau de bord</a>
      </Sheet.Content>
    </Sheet.Root>
  );
}

async function open(side: SheetSide, dir: 'ltr' | 'rtl' = 'ltr') {
  const user = userEvent.setup();
  renderWithDir(<Example side={side} />, { dir });
  await user.click(screen.getByRole('button', { name: 'Plus' }));
  return { user, dialog: screen.getByRole('dialog', { name: 'Menu' }) };
}

describe('Sheet', () => {
  it.each(['ltr', 'rtl'] as const)(
    'side="start" anchors at inline-start with logical classes only (%s)',
    async (dir) => {
      const { dialog } = await open('start', dir);
      const tokens = classTokens(dialog.parentElement!);
      expect(tokens).toContain('start-0');
      expect(tokens).not.toContain('left-0');
      expect(tokens).toContain('data-[state=open]:animate-sheet-in-start');
      expectNoPhysicalClasses(document.body);
    },
  );

  it('side="end" anchors at inline-end', async () => {
    const { dialog } = await open('end', 'rtl');
    const tokens = classTokens(dialog.parentElement!);
    expect(tokens).toContain('end-0');
    expect(tokens).toContain('data-[state=open]:animate-sheet-in-end');
    expectNoPhysicalClasses(document.body);
  });

  it('side="bottom" is full-width at the bottom', async () => {
    const { dialog } = await open('bottom');
    const tokens = classTokens(dialog.parentElement!);
    expect(tokens).toEqual(expect.arrayContaining(['bottom-0', 'start-0', 'end-0']));
    expect(tokens).toContain('data-[state=open]:animate-sheet-in-bottom');
  });

  it('closes with its labelled close button and restores focus', async () => {
    const { user } = await open('start');
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plus' })).toHaveFocus();
  });
});
