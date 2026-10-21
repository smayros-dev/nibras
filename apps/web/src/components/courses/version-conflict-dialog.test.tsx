import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../../test/render';
import { VersionConflictDialog } from './version-conflict-dialog';

function renderDialog(locale: 'fr' | 'ar' = 'fr') {
  const onReload = vi.fn();
  const onOverwrite = vi.fn();
  const onOpenChange = vi.fn();
  renderWithIntl(
    <VersionConflictDialog
      open
      currentVersion={7}
      onOpenChange={onOpenChange}
      onReload={onReload}
      onOverwrite={onOverwrite}
    />,
    { locale },
  );
  return { onReload, onOverwrite, onOpenChange };
}

describe('VersionConflictDialog', () => {
  it('« Recharger » calls the reload callback and closes', async () => {
    const { onReload, onOverwrite, onOpenChange } = renderDialog();
    expect(
      screen.getByRole('alertdialog', { name: tr('fr', 'courses.conflictTitle') }),
    ).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: tr('fr', 'courses.conflictReload') }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onOverwrite).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('« Écraser » re-submits with the current version', async () => {
    const { onReload, onOverwrite } = renderDialog();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: tr('fr', 'courses.conflictOverwrite') }));
    expect(onOverwrite).toHaveBeenCalledWith(7);
    expect(onReload).not.toHaveBeenCalled();
  });

  it('renders in Arabic', () => {
    renderDialog('ar');
    expect(
      screen.getByRole('button', { name: tr('ar', 'courses.conflictOverwrite') }),
    ).toBeInTheDocument();
  });
});
