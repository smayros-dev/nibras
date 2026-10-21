import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InviteLink } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../test/render';
import { InviteLinkCard } from './invite-link-card';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const LINK: InviteLink = {
  id: 'l1',
  code: 'ABCD2345',
  label: 'Groupe du mardi',
  requiresApproval: true,
  maxUses: 50,
  usesCount: 3,
  expiresAt: '2026-11-17T08:00:00.000Z',
  status: 'ACTIVE',
  createdByUserId: 'u1',
  teacherUserId: null,
  courseIds: [],
  createdAt: '2026-10-18T08:00:00.000Z',
  url: 'http://localhost:3000/fr/join/ABCD2345',
};

const fill = (key: string, values: Record<string, string | number>) =>
  tr('fr', key).replace(/\{(\w+)\}/g, (_, k: string) => String(values[k]));

function renderCard(isOrg = false, canManage = true) {
  return renderWithIntl(<InviteLinkCard wid="w1" isOrg={isOrg} canManage={canManage} />);
}

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  api.DELETE.mockReset();
  api.GET.mockResolvedValue({ data: [LINK] });
  api.POST.mockResolvedValue({ data: { ...LINK, id: 'l2', code: 'WXYZ6789' } });
  api.DELETE.mockResolvedValue({ data: undefined });
});

describe('InviteLinkCard', () => {
  it('lists the links with their code, uses, status and approval', async () => {
    renderCard();
    const item = (await screen.findByText('ABCD2345')).closest('li')!;
    expect(within(item).getByText('Groupe du mardi')).toBeVisible();
    expect(within(item).getByText(fill('inviteLinks.uses', { used: 3, max: 50 }))).toBeVisible();
    expect(within(item).getByText(tr('fr', 'inviteLinks.status_ACTIVE'))).toBeVisible();
    expect(within(item).getByText(tr('fr', 'inviteLinks.approval'))).toBeVisible();
    expect(within(item).getByText(LINK.url)).toBeVisible();
  });

  it('creates a link with the defaults (approval off in a personal workspace)', async () => {
    renderCard();
    await screen.findByText('ABCD2345');
    const ue = userEvent.setup();
    const approval = screen.getByRole('checkbox', {
      name: tr('fr', 'inviteLinks.requiresApproval'),
    });
    expect(approval).not.toBeChecked();
    await ue.click(screen.getByRole('button', { name: tr('fr', 'inviteLinks.create') }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/invite-links', {
        params: { path: { wid: 'w1' } },
        body: { requiresApproval: false, courseIds: [], maxUses: 50 },
      }),
    );
    expect(await screen.findByText(tr('fr', 'inviteLinks.created'))).toBeInTheDocument();
    expect(api.GET).toHaveBeenCalledTimes(2);
  });

  it('defaults approval on in an organisation and sends the label and the expiry', async () => {
    renderCard(true);
    await screen.findByText('ABCD2345');
    const ue = userEvent.setup();
    expect(
      screen.getByRole('checkbox', { name: tr('fr', 'inviteLinks.requiresApproval') }),
    ).toBeChecked();
    await ue.type(screen.getByLabelText(tr('fr', 'inviteLinks.label')), 'Terminale');
    const maxUses = screen.getByLabelText(tr('fr', 'inviteLinks.maxUses'));
    await ue.clear(maxUses);
    await ue.type(maxUses, '30');
    await ue.type(screen.getByLabelText(tr('fr', 'inviteLinks.expiresAt')), '2026-12-31');
    await ue.click(screen.getByRole('button', { name: tr('fr', 'inviteLinks.create') }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/invite-links', {
        params: { path: { wid: 'w1' } },
        body: {
          label: 'Terminale',
          requiresApproval: true,
          courseIds: [],
          maxUses: 30,
          expiresAt: '2026-12-31T23:59:59.000Z',
        },
      }),
    );
  });

  it('the copy button writes the url to the clipboard', async () => {
    renderCard();
    // user-event installs its own clipboard stub on `navigator`.
    const ue = userEvent.setup();
    await ue.click(
      await screen.findByRole('button', { name: fill('inviteLinks.copy', { code: 'ABCD2345' }) }),
    );
    expect(await navigator.clipboard.readText()).toBe(LINK.url);
    expect(await screen.findByText(tr('fr', 'inviteLinks.copied'))).toBeInTheDocument();
  });

  it('Désactiver asks for confirmation, then disables', async () => {
    renderCard();
    const ue = userEvent.setup();
    await ue.click(
      await screen.findByRole('button', {
        name: fill('inviteLinks.disableFor', { code: 'ABCD2345' }),
      }),
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: fill('inviteLinks.disableTitle', { code: 'ABCD2345' }),
    });
    await ue.click(
      within(dialog).getByRole('button', { name: tr('fr', 'inviteLinks.disableConfirm') }),
    );
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith('/workspaces/{wid}/invite-links/{id}', {
        params: { path: { wid: 'w1', id: 'l1' } },
      }),
    );
    expect(await screen.findByText(tr('fr', 'inviteLinks.disabled'))).toBeInTheDocument();
  });

  it('read-only without the right to invite', async () => {
    renderCard(false, false);
    await screen.findByText('ABCD2345');
    expect(
      screen.queryByRole('button', { name: tr('fr', 'inviteLinks.create') }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: fill('inviteLinks.disableFor', { code: 'ABCD2345' }) }),
    ).not.toBeInTheDocument();
  });
});
