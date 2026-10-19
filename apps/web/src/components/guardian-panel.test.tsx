import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GuardianView } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockRouter, renderWithIntl, tr } from '../test/render';
import { GuardianPanel } from './guardian-panel';

const api = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const TOKEN = 'pg_abcdefghijklmnopqrstuvwxyz0123456789ABCDE';
const NEW_TOKEN = 'pg_newnewnewnewnewnewnewnewnewnewnewnewnewne';

function view(link: Partial<GuardianView['link']> = {}): GuardianView {
  return {
    student: { firstName: 'Amina', lastName: 'Trabelsi' },
    workspace: { id: 'w1', name: 'École Atlas', type: 'PERSONAL' },
    teacher: { firstName: 'Mohamed', lastName: 'Ben Ali' },
    link: {
      status: 'ACTIVE',
      grantedAt: '2026-10-19T08:00:00.000Z',
      revokedAt: null,
      relationship: 'PARENT',
      ...link,
    },
    sessions: [],
  };
}

const STUDENT = 'Amina Trabelsi';
const TEACHER = 'Mohamed Ben Ali';

function label(key: string, values: Record<string, string> = {}): string {
  return tr('fr', key).replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
}

beforeEach(() => api.POST.mockReset());

describe('GuardianPanel', () => {
  it('ACTIVE: the sessions heading, the granted badge, the empty sessions state and the revoke action', () => {
    renderWithIntl(<GuardianPanel token={TOKEN} view={view()} />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: label('guardian.pageTitle', { student: STUDENT }),
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(label('guardian.status_ACTIVE'))).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: label('guardian.noSessions') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: label('guardian.revoke') })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: label('guardian.regrant') }),
    ).not.toBeInTheDocument();
  });

  it('revoke asks first (D-O5 wording), posts and re-reads the page', async () => {
    const router = mockRouter();
    api.POST.mockResolvedValue({ data: undefined, response: { status: 204 } });
    const ue = userEvent.setup();
    renderWithIntl(<GuardianPanel token={TOKEN} view={view()} />);
    await ue.click(screen.getByRole('button', { name: label('guardian.revoke') }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(
      label('guardian.revokeDescription', { student: STUDENT, teacher: TEACHER }),
    );
    expect(api.POST).not.toHaveBeenCalled();
    await ue.click(within(dialog).getByRole('button', { name: label('guardian.revokeConfirm') }));

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/guardian/{token}/revoke', {
        params: { path: { token: TOKEN } },
      }),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('REVOKED shows the re-grant action (not revoke); re-granting posts the identity and moves to the new page', async () => {
    const router = mockRouter();
    api.POST.mockResolvedValue({
      data: { guardianPageUrl: `http://localhost:3000/fr/guardian/${NEW_TOKEN}` },
    });
    const ue = userEvent.setup();
    renderWithIntl(
      <GuardianPanel
        token={TOKEN}
        view={view({ status: 'REVOKED', revokedAt: '2026-10-20T08:00:00.000Z' })}
      />,
    );
    expect(screen.getByText(label('guardian.status_REVOKED'))).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: label('guardian.revoke') }),
    ).not.toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: label('guardian.regrant') }));

    fireEvent.change(screen.getByLabelText(label('guardian.firstName')), {
      target: { value: 'Karim' },
    });
    fireEvent.change(screen.getByLabelText(label('guardian.lastName')), {
      target: { value: 'Trabelsi' },
    });
    fireEvent.change(screen.getByLabelText(label('guardian.relationship')), {
      target: { value: 'PARENT' },
    });
    const submit = screen.getByRole('button', { name: label('guardian.regrantSubmit') });
    expect(submit).toBeDisabled();
    await ue.click(
      screen.getByRole('checkbox', {
        name: label('guardian.authorize', { student: STUDENT, teacher: TEACHER }),
      }),
    );
    await ue.click(submit);

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/guardian/{token}/grant', {
        params: { path: { token: TOKEN } },
        body: {
          guardianFirstName: 'Karim',
          guardianLastName: 'Trabelsi',
          relationship: 'PARENT',
          acceptNotice: true,
        },
      }),
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/guardian/${NEW_TOKEN}`));
  });

  it('REFUSED also offers the re-grant', () => {
    renderWithIntl(
      <GuardianPanel token={TOKEN} view={view({ status: 'REFUSED', grantedAt: null })} />,
    );
    expect(screen.getByText(label('guardian.status_REFUSED'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: label('guardian.regrant') })).toBeInTheDocument();
  });

  it('a revoke refused by the API (409) is reported, the page re-read', async () => {
    const router = mockRouter();
    api.POST.mockResolvedValue({
      error: { code: 'GUARDIAN_LINK_INACTIVE', message: 'Inactive' },
      response: { status: 409 },
    });
    const ue = userEvent.setup();
    renderWithIntl(<GuardianPanel token={TOKEN} view={view()} />);
    await ue.click(screen.getByRole('button', { name: label('guardian.revoke') }));
    const dialog = await screen.findByRole('alertdialog');
    await ue.click(within(dialog).getByRole('button', { name: label('guardian.revokeConfirm') }));
    expect(await screen.findByText(tr('fr', 'errors.GUARDIAN_LINK_INACTIVE'))).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
  });

  it('renders right-to-left in Arabic', () => {
    renderWithIntl(<GuardianPanel token={TOKEN} view={view()} />, { locale: 'ar' });
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: tr('ar', 'guardian.revoke') })).toBeInTheDocument();
  });
});
