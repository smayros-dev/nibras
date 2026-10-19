import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InvitationPreview } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockRouter, renderWithIntl, tr } from '../test/render';
import { InvitationAcceptForm } from './invitation-accept-form';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz0123456789ABCD';

function preview(extra: Partial<InvitationPreview> = {}): InvitationPreview {
  return {
    workspace: { id: 'w1', name: 'École Atlas', type: 'PERSONAL' },
    inviter: { firstName: 'Mohamed', lastName: 'Ben Ali' },
    role: 'STUDENT',
    emailMasked: 'a***@example.com',
    accountExists: false,
    viewer: 'ANONYMOUS',
    requiresBirthDate: true,
    guardianEmailPrefilled: false,
    expiresAt: '2026-10-26T08:00:00.000Z',
    message: null,
    ...extra,
  };
}

/** A birth date `years` years before today (UTC), minus one day so the birthday has passed. */
function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const label = (key: string) => tr('fr', key);

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
});

describe('InvitationAcceptForm', () => {
  it('MISMATCH shows the masked email and the switch-account button, no form', () => {
    renderWithIntl(
      <InvitationAcceptForm token={TOKEN} preview={preview({ viewer: 'MISMATCH' })} />,
    );
    expect(
      screen.getByText(label('invite.mismatch').replace('{email}', 'a***@example.com')),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: label('invite.switchAccount').replace('{email}', 'a***@example.com'),
      }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(label('auth.register.password'))).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: label('invite.joinSubmit') }),
    ).not.toBeInTheDocument();
  });

  it('MISMATCH: signing out refreshes the page in place (no navigation to login)', async () => {
    const router = mockRouter();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderWithIntl(
        <InvitationAcceptForm token={TOKEN} preview={preview({ viewer: 'MISMATCH' })} />,
      );
      await userEvent.click(
        screen.getByRole('button', {
          name: label('invite.switchAccount').replace('{email}', 'a***@example.com'),
        }),
      );
      await waitFor(() => expect(router.refresh).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/logout', expect.anything());
      expect(router.replace).not.toHaveBeenCalled();
      expect(router.push).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ANONYMOUS with an existing account links to login with the invitation as next', () => {
    renderWithIntl(
      <InvitationAcceptForm token={TOKEN} preview={preview({ accountExists: true })} />,
    );
    const login = screen.getByRole('link', { name: label('invite.login') });
    expect(login).toHaveAttribute('href', `/login?next=${encodeURIComponent(`/invite/${TOKEN}`)}`);
    expect(screen.queryByLabelText(label('auth.register.password'))).not.toBeInTheDocument();
  });

  it('ANONYMOUS student: the guardian email field appears only once the birth date makes a minor', () => {
    renderWithIntl(<InvitationAcceptForm token={TOKEN} preview={preview()} />);
    const birthDate = screen.getByLabelText(label('invite.birthDate'));
    expect(screen.queryByLabelText(label('invite.guardianEmail'))).not.toBeInTheDocument();

    fireEvent.change(birthDate, { target: { value: yearsAgo(30) } });
    expect(screen.queryByLabelText(label('invite.guardianEmail'))).not.toBeInTheDocument();

    fireEvent.change(birthDate, { target: { value: yearsAgo(14) } });
    expect(screen.getByLabelText(label('invite.guardianEmail'))).toBeInTheDocument();
    expect(screen.getByText(label('invite.guardianHint'))).toBeInTheDocument();
  });

  it('ANONYMOUS register posts mode REGISTER and an adult lands on /app', async () => {
    const router = mockRouter();
    api.POST.mockResolvedValue({
      data: {
        workspace: { id: 'w1', name: 'École Atlas', type: 'PERSONAL' },
        membershipStatus: 'ACTIVE',
        role: 'STUDENT',
        user: { locale: 'fr' },
      },
    });
    const ue = userEvent.setup();
    renderWithIntl(<InvitationAcceptForm token={TOKEN} preview={preview()} />);
    fireEvent.change(screen.getByLabelText(label('auth.register.firstName')), {
      target: { value: 'Amina' },
    });
    fireEvent.change(screen.getByLabelText(label('auth.register.lastName')), {
      target: { value: 'Trabelsi' },
    });
    fireEvent.change(screen.getByLabelText(label('auth.register.password'), { exact: false }), {
      target: { value: 'un mot de passe assez long' },
    });
    fireEvent.change(screen.getByLabelText(label('invite.birthDate')), {
      target: { value: yearsAgo(25) },
    });
    await ue.click(screen.getByRole('checkbox'));
    await ue.click(screen.getByRole('button', { name: label('invite.registerSubmit') }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/app'));
    const [path, init] = api.POST.mock.calls[0]!;
    expect(path).toBe('/invitations/{token}/accept');
    expect(init.params).toEqual({ path: { token: TOKEN } });
    expect(init.body).toMatchObject({
      mode: 'REGISTER',
      firstName: 'Amina',
      lastName: 'Trabelsi',
      birthDate: yearsAgo(25),
      acceptTerms: true,
      acceptPrivacy: true,
    });
    expect(init.body).not.toHaveProperty('guardianEmail');
  });

  it('MATCH posts mode JOIN and redirects a minor to /app/w/{wid}', async () => {
    const router = mockRouter();
    api.POST.mockResolvedValue({
      data: {
        workspace: { id: 'w1', name: 'École Atlas', type: 'PERSONAL' },
        membershipStatus: 'PENDING_GUARDIAN_CONSENT',
        role: 'STUDENT',
        user: { locale: 'fr' },
      },
    });
    const ue = userEvent.setup();
    renderWithIntl(<InvitationAcceptForm token={TOKEN} preview={preview({ viewer: 'MATCH' })} />);
    expect(
      screen.getByText(label('invite.join').replace('{name}', 'Mohamed Ben Ali')),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(label('invite.birthDate')), {
      target: { value: yearsAgo(13) },
    });
    fireEvent.change(screen.getByLabelText(label('invite.guardianEmail')), {
      target: { value: 'parent@example.com' },
    });
    await ue.click(screen.getByRole('button', { name: label('invite.joinSubmit') }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/app/w/w1'));
    expect(api.POST.mock.calls[0]![1].body).toEqual({
      mode: 'JOIN',
      birthDate: yearsAgo(13),
      guardianEmail: 'parent@example.com',
    });
  });

  it('a staff invitation sends the new teacher to the verification page', async () => {
    const router = mockRouter();
    api.POST.mockResolvedValue({
      data: {
        workspace: { id: 'w1', name: 'École Atlas', type: 'ORGANIZATION' },
        membershipStatus: 'ACTIVE',
        role: 'TEACHER',
        user: { locale: 'fr' },
      },
    });
    renderWithIntl(
      <InvitationAcceptForm
        token={TOKEN}
        preview={preview({ viewer: 'MATCH', role: 'TEACHER', requiresBirthDate: false })}
      />,
    );
    expect(screen.queryByLabelText(label('invite.birthDate'))).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: label('invite.joinSubmit') }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/app/settings/verification'));
  });

  it('a 422 on guardianEmail is shown as a field error (translated)', async () => {
    api.POST.mockResolvedValue({
      error: {
        code: 'VALIDATION_FAILED',
        details: {
          issues: [{ path: ['guardianEmail'], code: 'invalid_format', format: 'email' }],
        },
      },
    });
    const ue = userEvent.setup();
    renderWithIntl(<InvitationAcceptForm token={TOKEN} preview={preview({ viewer: 'MATCH' })} />);
    fireEvent.change(screen.getByLabelText(label('invite.birthDate')), {
      target: { value: yearsAgo(12) },
    });
    fireEvent.change(screen.getByLabelText(label('invite.guardianEmail')), {
      target: { value: 'parent@example' },
    });
    await ue.click(screen.getByRole('button', { name: label('invite.joinSubmit') }));

    const guardian = screen.getByLabelText(label('invite.guardianEmail'));
    await waitFor(() => expect(guardian).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText(label('validation.invalid_format_email'))).toBeInTheDocument();
    expect(guardian).toHaveFocus();
  });

  it('GUARDIAN_EMAIL_REQUIRED reveals the guardian field with the translated error', async () => {
    api.POST.mockResolvedValue({ error: { code: 'GUARDIAN_EMAIL_REQUIRED' } });
    renderWithIntl(
      <InvitationAcceptForm
        token={TOKEN}
        preview={preview({ viewer: 'MATCH', requiresBirthDate: false })}
      />,
    );
    expect(screen.queryByLabelText(label('invite.guardianEmail'))).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: label('invite.joinSubmit') }));
    const guardian = await screen.findByLabelText(label('invite.guardianEmail'));
    await waitFor(() => expect(guardian).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText(label('errors.GUARDIAN_EMAIL_REQUIRED'))).toBeInTheDocument();
  });

  it('renders rtl in ar without raw keys', () => {
    renderWithIntl(<InvitationAcceptForm token={TOKEN} preview={preview()} />, {
      locale: 'ar',
    });
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.body.textContent).not.toMatch(/\b(invite|auth|errors)\.[A-Za-z_]+/);
  });
});
