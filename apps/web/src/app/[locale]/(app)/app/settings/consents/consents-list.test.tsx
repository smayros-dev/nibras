import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConsentRecord } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../../../../../../test/render';
import { ConsentsList } from './consents-list';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('../../../../../../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const MARKETING: ConsentRecord = {
  type: 'MARKETING',
  version: '2026-01',
  grantedAt: '2026-10-01T08:00:00.000Z',
  revokedAt: null,
  current: true,
};

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  api.GET.mockResolvedValue({ data: [MARKETING] });
  api.POST.mockResolvedValue({ data: undefined });
});

const revokeName = () => tr('fr', 'settings.consents.revoke');

describe('ConsentsList', () => {
  it('cancelling the withdrawal makes no API call and returns focus to the row button', async () => {
    const ue = userEvent.setup();
    renderWithIntl(<ConsentsList />);
    const rowButton = await screen.findByRole('button', { name: revokeName() });
    await ue.click(rowButton);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(tr('fr', 'settings.consents.types.MARKETING'));
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'common.cancel') }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(api.POST).not.toHaveBeenCalled();
    await waitFor(() => expect(rowButton).toHaveFocus());
  });

  it('Escape also returns focus to the row button', async () => {
    const ue = userEvent.setup();
    renderWithIntl(<ConsentsList />);
    const rowButton = await screen.findByRole('button', { name: revokeName() });
    await ue.click(rowButton);
    await screen.findByRole('alertdialog');
    await ue.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(rowButton).toHaveFocus());
  });

  it('confirming calls /revoke and shows the toast', async () => {
    const ue = userEvent.setup();
    renderWithIntl(<ConsentsList />);
    await ue.click(await screen.findByRole('button', { name: revokeName() }));
    const dialog = await screen.findByRole('alertdialog');
    api.GET.mockResolvedValue({ data: [{ ...MARKETING, revokedAt: '2026-10-17T08:00:00.000Z' }] });
    await ue.click(within(dialog).getByRole('button', { name: revokeName() }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/me/consents/{type}/revoke', {
        params: { path: { type: 'MARKETING' } },
      }),
    );
    expect(await screen.findByText(tr('fr', 'settings.consents.revoked'))).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});
