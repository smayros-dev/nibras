import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MyWorkspace } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../test/render';
import { MembershipPendingPanel } from './membership-pending-panel';

const api = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

function membership(
  status: MyWorkspace['status'],
  guardian: MyWorkspace['guardian'] = {
    emailMasked: 'p***@example.com',
    status: 'PENDING',
    consentExpiresAt: '2026-11-02T08:00:00.000Z',
  },
): MyWorkspace {
  return {
    workspace: {
      id: 'w1',
      name: 'École Atlas',
      slug: 'ecole-atlas',
      type: 'PERSONAL',
      status: 'ACTIVE',
    },
    role: 'STUDENT',
    canTeach: false,
    status,
    guardian,
  };
}

const label = (key: string) => tr('fr', key);
const resendName = () => label('pending.resend');

beforeEach(() => api.POST.mockReset());

describe('MembershipPendingPanel', () => {
  it('PENDING_GUARDIAN_CONSENT names the masked guardian email and offers a resend', () => {
    renderWithIntl(<MembershipPendingPanel membership={membership('PENDING_GUARDIAN_CONSENT')} />);
    expect(
      screen.getByRole('heading', {
        name: label('pending.guardianWaiting').replace('{email}', 'p***@example.com'),
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: resendName() })).toBeEnabled();
  });

  it('SUSPENDED_NO_CONSENT distinguishes a refusal from no answer', () => {
    const { unmount } = renderWithIntl(
      <MembershipPendingPanel membership={membership('SUSPENDED_NO_CONSENT')} />,
    );
    expect(screen.getByRole('heading', { name: label('pending.noAnswer') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: resendName() })).toBeInTheDocument();
    unmount();
    renderWithIntl(
      <MembershipPendingPanel
        membership={membership('SUSPENDED_NO_CONSENT', {
          emailMasked: 'p***@example.com',
          status: 'REFUSED',
          consentExpiresAt: null,
        })}
      />,
    );
    expect(screen.getByRole('heading', { name: label('pending.refused') })).toBeInTheDocument();
  });

  it('SUSPENDED_CONSENT_REVOKED says the guardian withdrew and offers a resend', () => {
    renderWithIntl(<MembershipPendingPanel membership={membership('SUSPENDED_CONSENT_REVOKED')} />);
    expect(screen.getByRole('heading', { name: label('pending.revoked') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: resendName() })).toBeInTheDocument();
  });

  it('PENDING_APPROVAL waits for the teacher, with no action', () => {
    renderWithIntl(<MembershipPendingPanel membership={membership('PENDING_APPROVAL', null)} />);
    expect(screen.getByRole('heading', { name: label('pending.approval') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: resendName() })).not.toBeInTheDocument();
  });

  it('a successful resend posts to /me and shows a success toast', async () => {
    api.POST.mockResolvedValue({
      data: {
        emailMasked: 'p***@example.com',
        status: 'PENDING',
        consentExpiresAt: '2026-11-03T08:00:00.000Z',
      },
    });
    renderWithIntl(<MembershipPendingPanel membership={membership('SUSPENDED_NO_CONSENT')} />);
    await userEvent.click(screen.getByRole('button', { name: resendName() }));
    expect(await screen.findByText(label('pending.resent'))).toBeInTheDocument();
    expect(api.POST).toHaveBeenCalledWith('/me/workspaces/{wid}/guardian/resend-consent', {
      params: { path: { wid: 'w1' } },
    });
  });

  it('a 429 disables the button with the minutes left', async () => {
    api.POST.mockResolvedValue({
      error: { code: 'RATE_LIMITED', details: { retryAfterS: 430 } },
    });
    renderWithIntl(<MembershipPendingPanel membership={membership('PENDING_GUARDIAN_CONSENT')} />);
    const button = screen.getByRole('button', { name: resendName() });
    await userEvent.click(button);
    expect(await screen.findByText(label('pending.retryIn').replace('{min}', '8'))).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: resendName() })).toBeDisabled());
  });

  it('renders rtl in ar without raw keys', () => {
    renderWithIntl(<MembershipPendingPanel membership={membership('PENDING_GUARDIAN_CONSENT')} />, {
      locale: 'ar',
    });
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.body.textContent).not.toMatch(/\bpending\.[A-Za-z_]+/);
  });
});
