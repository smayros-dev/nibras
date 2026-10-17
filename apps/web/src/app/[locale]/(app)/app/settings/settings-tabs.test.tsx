import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockRouter, renderWithIntl, tr } from '../../../../../test/render';
import { SettingsTabs } from './settings-tabs';

describe('SettingsTabs', () => {
  it('keeps the coming-soon tabs focusable and announced as disabled, without activating them', async () => {
    const ue = userEvent.setup();
    mockRouter({ pathname: '/app/settings/profile' });
    renderWithIntl(<SettingsTabs />);
    const soon = screen.getByRole('tab', {
      name: new RegExp(tr('fr', 'settings.nav.notifications')),
    });
    expect(soon).not.toBeDisabled();
    expect(soon).toHaveAttribute('aria-disabled', 'true');
    expect(soon).toHaveTextContent(tr('fr', 'settings.soon'));

    const profile = screen.getByRole('tab', { name: tr('fr', 'settings.nav.profile') });
    expect(profile).toHaveAttribute('aria-current', 'page');

    soon.focus();
    expect(soon).toHaveFocus();
    await ue.keyboard('{Enter}');
    await ue.click(soon);
    expect(soon).not.toHaveAttribute('aria-selected', 'true');
    expect(profile).toHaveAttribute('aria-current', 'page');
  });
});
