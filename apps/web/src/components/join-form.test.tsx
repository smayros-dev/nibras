import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JoinPreview } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockRouter, renderWithIntl, tr } from '../test/render';
import { JoinForm } from './join-form';

const api = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const CODE = 'ABCD2345';

function preview(extra: Partial<JoinPreview> = {}): JoinPreview {
  return {
    workspace: { id: 'w1', name: 'École Atlas', type: 'PERSONAL' },
    teacher: { firstName: 'Mohamed', lastName: 'Ben Ali' },
    requiresApproval: false,
    viewer: 'ANONYMOUS',
    accountRequired: true,
    ...extra,
  };
}

function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const label = (key: string) => tr('fr', key);

function result(membershipStatus: string, emailVerifiedAt: string | null) {
  return {
    data: {
      workspace: { id: 'w1', name: 'École Atlas', type: 'PERSONAL' },
      membershipStatus,
      role: 'STUDENT',
      user: { locale: 'fr', emailVerifiedAt },
    },
  };
}

async function fillRegister() {
  const ue = userEvent.setup();
  fireEvent.change(screen.getByLabelText(label('auth.register.firstName')), {
    target: { value: 'Amina' },
  });
  fireEvent.change(screen.getByLabelText(label('auth.register.lastName')), {
    target: { value: 'Trabelsi' },
  });
  fireEvent.change(screen.getByLabelText(label('auth.register.email')), {
    target: { value: 'amina@example.com' },
  });
  fireEvent.change(screen.getByLabelText(label('auth.register.password'), { exact: false }), {
    target: { value: 'un mot de passe assez long' },
  });
  fireEvent.change(screen.getByLabelText(label('invite.birthDate')), {
    target: { value: yearsAgo(20) },
  });
  await ue.click(screen.getByRole('checkbox'));
  await ue.click(screen.getByRole('button', { name: label('invite.registerSubmit') }));
}

beforeEach(() => api.POST.mockReset());

describe('JoinForm', () => {
  it('REGISTER posts the email; with approval it shows the request-sent state', async () => {
    const router = mockRouter();
    api.POST.mockResolvedValue(result('PENDING_APPROVAL', null));
    renderWithIntl(<JoinForm code={CODE} preview={preview({ requiresApproval: true })} />);
    expect(
      screen.getByText(label('join.approvalNotice').replace('{teacher}', 'Mohamed Ben Ali')),
    ).toBeInTheDocument();
    await fillRegister();

    expect(
      await screen.findByRole('heading', {
        name: label('join.requested').replace('{teacher}', 'Mohamed Ben Ali'),
      }),
    ).toBeInTheDocument();
    // An unverified account is told to check its mailbox.
    expect(screen.getByRole('link', { name: label('join.verifyEmail') })).toHaveAttribute(
      'href',
      '/verify-email',
    );
    const [path, init] = api.POST.mock.calls[0]!;
    expect(path).toBe('/join/{code}/accept');
    expect(init.params).toEqual({ path: { code: CODE } });
    expect(init.body).toMatchObject({ mode: 'REGISTER', email: 'amina@example.com' });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('an unverified REGISTER without approval goes to /verify-email', async () => {
    const router = mockRouter();
    api.POST.mockResolvedValue(result('ACTIVE', null));
    renderWithIntl(<JoinForm code={CODE} preview={preview()} />);
    await fillRegister();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/verify-email'));
  });

  it('EMAIL_TAKEN is shown on the email field', async () => {
    api.POST.mockResolvedValue({ error: { code: 'EMAIL_TAKEN' } });
    renderWithIntl(<JoinForm code={CODE} preview={preview()} />);
    await fillRegister();
    const email = screen.getByLabelText(label('auth.register.email'));
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText(label('errors.EMAIL_TAKEN'))).toBeInTheDocument();
  });

  it('SIGNED_IN posts mode JOIN; BIRTH_DATE_REQUIRED reveals the birth date field', async () => {
    const router = mockRouter();
    api.POST.mockResolvedValueOnce({ error: { code: 'BIRTH_DATE_REQUIRED' } });
    api.POST.mockResolvedValueOnce(result('ACTIVE', '2026-10-01T08:00:00.000Z'));
    renderWithIntl(
      <JoinForm code={CODE} preview={preview({ viewer: 'SIGNED_IN', accountRequired: false })} />,
    );
    expect(screen.queryByLabelText(label('invite.birthDate'))).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: label('invite.joinSubmit') }));
    const birthDate = await screen.findByLabelText(label('invite.birthDate'));
    await waitFor(() => expect(birthDate).toHaveAttribute('aria-invalid', 'true'));

    fireEvent.change(birthDate, { target: { value: yearsAgo(22) } });
    await userEvent.click(screen.getByRole('button', { name: label('invite.joinSubmit') }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/app'));
    expect(api.POST.mock.calls[1]![1].body).toEqual({ mode: 'JOIN', birthDate: yearsAgo(22) });
  });
});
