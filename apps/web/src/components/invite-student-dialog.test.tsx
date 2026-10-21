import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MemberSummary, MembershipRole, WorkspaceDetail } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../test/render';
import { InviteStudentDialog } from './invite-student-dialog';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const SARA = 'aaaaaaaa-0000-4000-8000-000000000003';
const KARIM = 'aaaaaaaa-0000-4000-8000-000000000002';

function member(userId: string, firstName: string, role: MembershipRole, canTeach: boolean) {
  return {
    userId,
    firstName,
    lastName: 'Test',
    role,
    canTeach,
    status: 'ACTIVE',
    joinedAt: '2026-10-01T08:00:00.000Z',
  } satisfies MemberSummary;
}

function detail(myRole: MembershipRole, type: WorkspaceDetail['type']): WorkspaceDetail {
  return {
    id: 'w1',
    name: 'École Atlas',
    slug: 'ecole-atlas',
    type,
    status: 'ACTIVE',
    country: 'TN',
    defaultTimezone: 'Africa/Tunis',
    defaultLocale: 'fr',
    allowPersonalWorkspaces: true,
    createdAt: '2026-10-01T08:00:00.000Z',
    myRole,
    myCanTeach: false,
  };
}

const onInvited = vi.fn();
const onOpenChange = vi.fn();

function renderDialog(
  myRole: MembershipRole = 'OWNER',
  type: WorkspaceDetail['type'] = 'PERSONAL',
) {
  renderWithIntl(
    <InviteStudentDialog
      wid="w1"
      detail={detail(myRole, type)}
      open
      onOpenChange={onOpenChange}
      onInvited={onInvited}
    />,
  );
  return screen.getByRole('dialog', { name: tr('fr', 'invitations.inviteTitle') });
}

const fill = (key: string, values: Record<string, string>) =>
  tr('fr', key).replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  onInvited.mockReset();
  onOpenChange.mockReset();
  api.GET.mockImplementation(
    async (_path: string, opts: { params: { query: { role: MembershipRole } } }) => ({
      data: {
        items:
          opts.params.query.role === 'TEACHER'
            ? [member(SARA, 'Sara', 'TEACHER', true)]
            : [member(KARIM, 'Karim', 'ADMIN', true), member('x', 'Nadia', 'ADMIN', false)],
        nextCursor: null,
      },
    }),
  );
  api.POST.mockResolvedValue({ data: { id: 'inv1', email: 'nour@example.com' } });
});

describe('InviteStudentDialog', () => {
  it('posts the normalised body (empty optional fields left out) and toasts', async () => {
    const dialog = renderDialog();
    const ue = userEvent.setup();
    await ue.type(
      within(dialog).getByRole('textbox', { name: tr('fr', 'invitations.email') }),
      ' Nour@Example.com ',
    );
    await ue.type(within(dialog).getByLabelText(tr('fr', 'invitations.firstName')), 'Nour');
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'invitations.submit') }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/invitations', {
        params: { path: { wid: 'w1' } },
        body: { email: 'nour@example.com', role: 'STUDENT', courseIds: [], firstName: 'Nour' },
      }),
    );
    expect(
      await screen.findByText(fill('invitations.sent', { email: 'nour@example.com' })),
    ).toBeInTheDocument();
    expect(onInvited).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // A personal workspace has no teacher to assign.
    expect(
      within(dialog).queryByLabelText(tr('fr', 'invitations.teacher')),
    ).not.toBeInTheDocument();
  });

  it('409 INVITATION_PENDING is a field error on the email', async () => {
    api.POST.mockResolvedValue({
      error: { code: 'INVITATION_PENDING', message: 'x', details: { invitationId: 'inv1' } },
    });
    const dialog = renderDialog();
    const ue = userEvent.setup();
    const email = within(dialog).getByRole('textbox', { name: tr('fr', 'invitations.email') });
    await ue.type(email, 'nour@example.com');
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'invitations.submit') }));
    expect(await within(dialog).findByText(tr('fr', 'errors.INVITATION_PENDING'))).toBeVisible();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(onInvited).not.toHaveBeenCalled();
  });

  it('a 422 on the guardian email is shown on that field (translated)', async () => {
    api.POST.mockResolvedValue({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'x',
        details: { issues: [{ path: ['guardianEmail'], code: 'custom' }] },
      },
    });
    const dialog = renderDialog();
    const ue = userEvent.setup();
    await ue.type(
      within(dialog).getByRole('textbox', { name: tr('fr', 'invitations.email') }),
      'a@example.com',
    );
    const guardian = within(dialog).getByLabelText(tr('fr', 'invitations.guardianEmail'));
    await ue.type(guardian, 'a@example.com');
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'invitations.submit') }));
    await waitFor(() => expect(guardian).toHaveAttribute('aria-invalid', 'true'));
    expect(within(dialog).getByText(tr('fr', 'validation.invalid'))).toBeVisible();
  });

  it('TEACHER_NOT_VERIFIED shows an alert listing the missing steps with the verification link', async () => {
    api.POST.mockResolvedValue({
      error: {
        code: 'TEACHER_NOT_VERIFIED',
        message: 'x',
        details: { missing: ['PHONE', 'CODE_OF_CONDUCT'] },
      },
    });
    const dialog = renderDialog();
    const ue = userEvent.setup();
    await ue.type(
      within(dialog).getByRole('textbox', { name: tr('fr', 'invitations.email') }),
      'a@example.com',
    );
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'invitations.submit') }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(tr('fr', 'settings.verification.phone'));
    expect(alert).toHaveTextContent(tr('fr', 'settings.verification.coc'));
    expect(
      within(alert).getByRole('link', { name: tr('fr', 'invitations.verifyLink') }),
    ).toHaveAttribute('href', '/app/settings/verification');
  });

  it('an organisation admin may assign the student to a teaching member', async () => {
    const dialog = renderDialog('ADMIN', 'ORGANIZATION');
    const ue = userEvent.setup();
    const select = await within(dialog).findByLabelText(tr('fr', 'invitations.teacher'));
    await within(select).findByRole('option', { name: 'Sara Test' });
    // Admins who teach are listed, the others are not.
    expect(within(select).getByRole('option', { name: 'Karim Test' })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: 'Nadia Test' })).not.toBeInTheDocument();
    await ue.selectOptions(select, SARA);
    await ue.type(
      within(dialog).getByRole('textbox', { name: tr('fr', 'invitations.email') }),
      'a@example.com',
    );
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'invitations.submit') }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/invitations', {
        params: { path: { wid: 'w1' } },
        body: { email: 'a@example.com', role: 'STUDENT', courseIds: [], teacherUserId: SARA },
      }),
    );
  });

  it('an organisation TEACHER invites for himself (no teacher choice)', () => {
    const dialog = renderDialog('TEACHER', 'ORGANIZATION');
    expect(
      within(dialog).queryByLabelText(tr('fr', 'invitations.teacher')),
    ).not.toBeInTheDocument();
    expect(api.GET).not.toHaveBeenCalled();
  });
});
