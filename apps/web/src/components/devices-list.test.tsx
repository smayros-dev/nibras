import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionSummary } from '@tt/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockRouter, renderWithIntl, tr } from '../test/render';
import { DevicesList } from './devices-list';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const SESSIONS: SessionSummary[] = [
  {
    id: 's1',
    deviceLabel: 'Firefox · Windows',
    ip: '10.0.0.1',
    createdAt: '2026-10-01T08:00:00.000Z',
    lastSeenAt: '2026-10-17T08:00:00.000Z',
    current: true,
  },
  {
    id: 's2',
    deviceLabel: 'Safari · iOS',
    ip: '10.0.0.2',
    createdAt: '2026-10-02T08:00:00.000Z',
    lastSeenAt: '2026-10-16T08:00:00.000Z',
    current: false,
  },
];

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.GET.mockResolvedValue({ data: SESSIONS });
  api.DELETE.mockResolvedValue({ data: undefined });
});

describe('DevicesList', () => {
  it('lists the sessions with a named revoke action on the other devices', async () => {
    renderWithIntl(<DevicesList />);
    expect(await screen.findByTestId('device-current')).toHaveTextContent('Firefox · Windows');
    const revoke = screen.getByRole('button', {
      name: tr('fr', 'settings.security.revokeDevice').replace('{device}', 'Safari · iOS'),
    });
    await userEvent.setup().click(revoke);
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith('/auth/sessions/{id}', {
        params: { path: { id: 's2' } },
      }),
    );
  });

  it('confirms sign-out-everywhere in an alert dialog, then calls the API and goes to login', async () => {
    const ue = userEvent.setup();
    const router = mockRouter({ pathname: '/app/settings/security' });
    renderWithIntl(<DevicesList />);
    await screen.findByTestId('device-current');
    await ue.click(screen.getByRole('button', { name: tr('fr', 'settings.security.signOutAll') }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(tr('fr', 'settings.security.signOutAllConfirm'));
    expect(api.DELETE).not.toHaveBeenCalled();
    await ue.click(
      within(dialog).getByRole('button', { name: tr('fr', 'settings.security.signOutAll') }),
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/login'));
    expect(api.DELETE).toHaveBeenCalledWith('/auth/sessions');
  });

  it('does nothing when the confirmation is cancelled', async () => {
    const ue = userEvent.setup();
    const router = mockRouter();
    renderWithIntl(<DevicesList />, { locale: 'ar' });
    await screen.findByTestId('device-current');
    await ue.click(screen.getByRole('button', { name: tr('ar', 'settings.security.signOutAll') }));
    const dialog = await screen.findByRole('alertdialog');
    await ue.click(within(dialog).getByRole('button', { name: tr('ar', 'common.cancel') }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(api.DELETE).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});
