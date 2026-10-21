import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../test/render';
import { InviteStaffDialog } from './invite-staff-dialog';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const onInvited = vi.fn();
const onOpenChange = vi.fn();

function renderDialog(locale: 'fr' | 'ar' = 'fr') {
  renderWithIntl(
    <InviteStaffDialog wid="w1" open onOpenChange={onOpenChange} onInvited={onInvited} />,
    { locale },
  );
  return screen.getByRole('dialog', { name: tr(locale, 'members.inviteStaffTitle') });
}

const fill = (key: string, values: Record<string, string>) =>
  tr('fr', key).replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');

beforeEach(() => {
  api.POST.mockReset();
  onInvited.mockReset();
  onOpenChange.mockReset();
  api.POST.mockResolvedValue({ data: { id: 'inv1', email: 'sara@example.com', role: 'TEACHER' } });
});

describe('InviteStaffDialog', () => {
  it('posts a TEACHER invitation by default (normalised email, empty message left out)', async () => {
    const dialog = renderDialog();
    const ue = userEvent.setup();
    await ue.type(
      within(dialog).getByRole('textbox', { name: tr('fr', 'members.inviteStaffEmail') }),
      ' Sara@Example.com ',
    );
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'invitations.submit') }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/invitations', {
        params: { path: { wid: 'w1' } },
        body: { email: 'sara@example.com', role: 'TEACHER', courseIds: [] },
      }),
    );
    expect(
      await screen.findByText(fill('invitations.sent', { email: 'sara@example.com' })),
    ).toBeInTheDocument();
    expect(onInvited).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('offers TEACHER and ADMIN only, and sends the chosen role with the message', async () => {
    const dialog = renderDialog();
    const ue = userEvent.setup();
    const role = within(dialog).getByRole('combobox', { name: tr('fr', 'members.role') });
    expect(
      within(role)
        .getAllByRole('option')
        .map((o) => o.getAttribute('value')),
    ).toEqual(['TEACHER', 'ADMIN']);
    await ue.selectOptions(role, 'ADMIN');
    await ue.type(
      within(dialog).getByRole('textbox', { name: tr('fr', 'members.inviteStaffEmail') }),
      'karim@example.com',
    );
    await ue.type(
      within(dialog).getByRole('textbox', { name: tr('fr', 'invitations.message') }),
      ' Bienvenue ',
    );
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'invitations.submit') }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/invitations', {
        params: { path: { wid: 'w1' } },
        body: { email: 'karim@example.com', role: 'ADMIN', courseIds: [], message: 'Bienvenue' },
      }),
    );
  });

  it('409 ALREADY_MEMBER is a field error on the email', async () => {
    api.POST.mockResolvedValue({ error: { code: 'ALREADY_MEMBER', message: 'x' } });
    const dialog = renderDialog();
    const ue = userEvent.setup();
    const email = within(dialog).getByRole('textbox', {
      name: tr('fr', 'members.inviteStaffEmail'),
    });
    await ue.type(email, 'sara@example.com');
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'invitations.submit') }));
    expect(await within(dialog).findByText(tr('fr', 'errors.ALREADY_MEMBER'))).toBeVisible();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(onInvited).not.toHaveBeenCalled();
  });

  it('TEACHER_NOT_VERIFIED shows an alert naming the missing steps with the verification link', async () => {
    api.POST.mockResolvedValue({
      error: { code: 'TEACHER_NOT_VERIFIED', message: 'x', details: { missing: ['PHONE'] } },
    });
    const dialog = renderDialog();
    const ue = userEvent.setup();
    await ue.type(
      within(dialog).getByRole('textbox', { name: tr('fr', 'members.inviteStaffEmail') }),
      'sara@example.com',
    );
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'invitations.submit') }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(
      fill('members.inviteStaffNotVerified', { steps: tr('fr', 'settings.verification.phone') }),
    );
    expect(
      within(alert).getByRole('link', { name: tr('fr', 'invitations.verifyLink') }),
    ).toHaveAttribute('href', '/app/settings/verification');
  });

  it('a 403 (no staff management) is a form alert, translated', async () => {
    api.POST.mockResolvedValue({ error: { code: 'PERMISSION_DENIED', message: 'x' } });
    const dialog = renderDialog('ar');
    const ue = userEvent.setup();
    await ue.type(
      within(dialog).getByRole('textbox', { name: tr('ar', 'members.inviteStaffEmail') }),
      'sara@example.com',
    );
    await ue.click(within(dialog).getByRole('button', { name: tr('ar', 'invitations.submit') }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      tr('ar', 'errors.PERMISSION_DENIED'),
    );
  });
});
