import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InvitationSummary } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../test/render';
import { InvitationsList } from './invitations-list';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

function invitation(id: string, email: string, extra: Partial<InvitationSummary> = {}) {
  return {
    id,
    email,
    role: 'STUDENT',
    firstName: null,
    lastName: null,
    guardianEmail: null,
    status: 'PENDING',
    expiresAt: '2026-10-25T08:00:00.000Z',
    invitedByUserId: 'u1',
    invitedByName: 'Mohamed Ben Ali',
    teacherUserId: null,
    courseIds: [],
    resentCount: 0,
    lastSentAt: '2026-10-18T08:00:00.000Z',
    acceptedAt: null,
    revokedAt: null,
    createdAt: '2026-10-18T08:00:00.000Z',
    ...extra,
  } satisfies InvitationSummary;
}

const ITEMS = [
  invitation('inv1', 'nour@example.com', { firstName: 'Nour', lastName: 'Haddad' }),
  invitation('inv2', 'sami@example.com', { status: 'EXPIRED' }),
];

const fill = (key: string, values: Record<string, string | number>) =>
  tr('fr', key).replace(/\{(\w+)\}/g, (_, k: string) => String(values[k]));

const onChanged = vi.fn();

function renderList(canManage = true) {
  return renderWithIntl(
    <InvitationsList
      wid="w1"
      items={ITEMS}
      canManage={canManage}
      onChanged={onChanged}
      caption="Invitations"
    />,
  );
}

async function openMenu(email: string) {
  const ue = userEvent.setup();
  await ue.click(screen.getByRole('button', { name: fill('invitations.rowActions', { email }) }));
  return { ue, menu: await screen.findByRole('menu') };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  onChanged.mockReset();
  api.POST.mockResolvedValue({ data: ITEMS[0] });
  api.PATCH.mockResolvedValue({ data: ITEMS[0] });
  api.DELETE.mockResolvedValue({ data: undefined });
});

describe('InvitationsList', () => {
  it('shows each invitation with its status badge (pending, expired)', () => {
    renderList();
    const nour = screen.getByText('nour@example.com').closest('tr')!;
    expect(within(nour).getByText('Nour Haddad')).toBeVisible();
    expect(within(nour).getByText(tr('fr', 'invitations.status_PENDING'))).toBeVisible();
    const sami = screen.getByText('sami@example.com').closest('tr')!;
    expect(within(sami).getByText(tr('fr', 'invitations.status_EXPIRED'))).toBeVisible();
  });

  it('Renvoyer posts the resend and toasts; a 429 toasts the minutes left', async () => {
    renderList();
    const { ue, menu } = await openMenu('nour@example.com');
    await ue.click(within(menu).getByRole('menuitem', { name: tr('fr', 'invitations.resend') }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/invitations/{id}/resend', {
        params: { path: { wid: 'w1', id: 'inv1' } },
      }),
    );
    expect(
      await screen.findByText(fill('invitations.resent', { email: 'nour@example.com' })),
    ).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();

    api.POST.mockResolvedValueOnce({
      error: { code: 'RATE_LIMITED', message: 'x', details: { retryAfterS: 61 } },
    });
    const again = await openMenu('nour@example.com');
    await again.ue.click(
      within(again.menu).getByRole('menuitem', { name: tr('fr', 'invitations.resend') }),
    );
    expect(await screen.findByText(fill('invitations.retryIn', { min: 2 }))).toBeInTheDocument();
  });

  it('Révoquer asks for confirmation, then deletes', async () => {
    renderList();
    const { ue, menu } = await openMenu('nour@example.com');
    await ue.click(within(menu).getByRole('menuitem', { name: tr('fr', 'invitations.revoke') }));
    const dialog = await screen.findByRole('alertdialog', {
      name: fill('invitations.revokeTitle', { email: 'nour@example.com' }),
    });
    await ue.click(
      within(dialog).getByRole('button', { name: tr('fr', 'invitations.revokeConfirm') }),
    );
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith('/workspaces/{wid}/invitations/{id}', {
        params: { path: { wid: 'w1', id: 'inv1' } },
      }),
    );
    expect(await screen.findByText(tr('fr', 'invitations.revoked'))).toBeInTheDocument();
  });

  it('Modifier patches the names and guardian email of a pending invitation only', async () => {
    renderList();
    const { menu: expiredMenu } = await openMenu('sami@example.com');
    expect(
      within(expiredMenu).queryByRole('menuitem', { name: tr('fr', 'invitations.edit') }),
    ).not.toBeInTheDocument();
    await userEvent.setup().keyboard('{Escape}');

    const { ue, menu } = await openMenu('nour@example.com');
    await ue.click(within(menu).getByRole('menuitem', { name: tr('fr', 'invitations.edit') }));
    const dialog = await screen.findByRole('dialog', {
      name: fill('invitations.editTitle', { email: 'nour@example.com' }),
    });
    const first = within(dialog).getByLabelText(tr('fr', 'invitations.firstName'));
    expect(first).toHaveValue('Nour');
    await ue.clear(first);
    await ue.type(first, 'Noura');
    await ue.type(
      within(dialog).getByLabelText(tr('fr', 'invitations.guardianEmail')),
      'parent@example.com',
    );
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'invitations.save') }));
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith('/workspaces/{wid}/invitations/{id}', {
        params: { path: { wid: 'w1', id: 'inv1' } },
        body: { firstName: 'Noura', lastName: 'Haddad', guardianEmail: 'parent@example.com' },
      }),
    );
    expect(await screen.findByText(tr('fr', 'invitations.updated'))).toBeInTheDocument();
  });

  it('offers no action without the right to manage', () => {
    renderList(false);
    expect(
      screen.queryByRole('button', {
        name: fill('invitations.rowActions', { email: 'nour@example.com' }),
      }),
    ).not.toBeInTheDocument();
  });
});
