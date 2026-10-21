import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GuardianConsentPreview } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../test/render';
import { GuardianConsentForm } from './guardian-consent-form';

const api = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz0123456789ABCD';
const PAGE_TOKEN = 'pg_abcdefghijklmnopqrstuvwxyz0123456789ABCDE';

function preview(extra: Partial<GuardianConsentPreview> = {}): GuardianConsentPreview {
  return {
    student: { firstName: 'Amina', lastName: 'Trabelsi' },
    workspace: { name: 'École Atlas', type: 'PERSONAL' },
    teacher: { firstName: 'Mohamed', lastName: 'Ben Ali' },
    expiresAt: '2026-11-02T08:00:00.000Z',
    version: 'guardian-2026-10',
    noticeUrl: 'http://localhost:3000/fr/legal/minors',
    state: 'PENDING',
    ...extra,
  };
}

const STUDENT = 'Amina Trabelsi';
const TEACHER = 'Mohamed Ben Ali';

/** A `fr` catalogue message with its `{name}` placeholders filled. */
function label(key: string, values: Record<string, string> = {}): string {
  return tr('fr', key).replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
}

const names = { student: STUDENT, teacher: TEACHER };

function fillIdentity() {
  fireEvent.change(screen.getByLabelText(label('guardian.firstName')), {
    target: { value: 'Karim' },
  });
  fireEvent.change(screen.getByLabelText(label('guardian.lastName')), {
    target: { value: 'Trabelsi' },
  });
  fireEvent.change(screen.getByLabelText(label('guardian.relationship')), {
    target: { value: 'LEGAL_GUARDIAN' },
  });
}

beforeEach(() => api.POST.mockReset());

describe('GuardianConsentForm', () => {
  it('names the student, the teacher and the workspace, and links the minors notice in a new tab', () => {
    renderWithIntl(<GuardianConsentForm token={TOKEN} preview={preview()} />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: label('guardian.consentTitle', { ...names, workspace: 'École Atlas' }),
      }),
    ).toBeInTheDocument();
    const notice = screen.getByRole('link', {
      name: `${label('guardian.notice')} ${label('common.newTab')}`,
    });
    expect(notice).toHaveAttribute('href', 'http://localhost:3000/fr/legal/minors');
    expect(notice).toHaveAttribute('target', '_blank');
    expect(notice.getAttribute('rel')).toContain('noreferrer');
  });

  it('GRANT is disabled until the authorisation box is checked, then posts the relationship', async () => {
    api.POST.mockResolvedValue({
      data: {
        decision: 'GRANT',
        guardianPageUrl: `http://localhost:3000/fr/guardian/${PAGE_TOKEN}`,
      },
    });
    const ue = userEvent.setup();
    renderWithIntl(<GuardianConsentForm token={TOKEN} preview={preview()} />);
    const grant = screen.getByRole('button', { name: label('guardian.grant') });
    expect(grant).toBeDisabled();

    fillIdentity();
    expect(grant).toBeDisabled();
    await ue.click(screen.getByRole('checkbox', { name: label('guardian.authorize', names) }));
    expect(grant).toBeEnabled();
    await ue.click(grant);

    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
    expect(api.POST).toHaveBeenCalledWith('/guardian-consent/{token}', {
      params: { path: { token: TOKEN } },
      body: {
        decision: 'GRANT',
        guardianFirstName: 'Karim',
        guardianLastName: 'Trabelsi',
        relationship: 'LEGAL_GUARDIAN',
        acceptNotice: true,
      },
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: label('guardian.granted', names) }),
    ).toBeInTheDocument();
    // The guardian page, in the current locale (the API's url carries the workspace's locale).
    expect(
      screen.getByRole('link', { name: label('guardian.viewSessions', { student: STUDENT }) }),
    ).toHaveAttribute('href', `/guardian/${PAGE_TOKEN}`);
  });

  it('REFUSE opens the confirm dialog first, then posts a refusal without the notice', async () => {
    api.POST.mockResolvedValue({ data: { decision: 'REFUSE' } });
    const ue = userEvent.setup();
    renderWithIntl(<GuardianConsentForm token={TOKEN} preview={preview()} />);
    fillIdentity();
    await ue.click(screen.getByRole('button', { name: label('guardian.refuse') }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(label('guardian.refuseTitle', { student: STUDENT }));
    expect(api.POST).not.toHaveBeenCalled();
    await ue.click(within(dialog).getByRole('button', { name: label('guardian.refuseConfirm') }));

    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
    expect(api.POST).toHaveBeenCalledWith('/guardian-consent/{token}', {
      params: { path: { token: TOKEN } },
      body: {
        decision: 'REFUSE',
        guardianFirstName: 'Karim',
        guardianLastName: 'Trabelsi',
        relationship: 'LEGAL_GUARDIAN',
      },
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: label('guardian.refused', names) }),
    ).toBeInTheDocument();
  });

  it('REFUSE with empty fields asks for them instead of opening the dialog', async () => {
    const ue = userEvent.setup();
    renderWithIntl(<GuardianConsentForm token={TOKEN} preview={preview()} />);
    await ue.click(screen.getByRole('button', { name: label('guardian.refuse') }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText(label('guardian.firstName'))).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText(label('guardian.relationship'))).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('shows a 410 as the decided page', async () => {
    api.POST.mockResolvedValue({
      error: { code: 'TOKEN_INVALID', message: 'This link is invalid' },
      response: { status: 410 },
    });
    const ue = userEvent.setup();
    renderWithIntl(<GuardianConsentForm token={TOKEN} preview={preview()} />);
    fillIdentity();
    await ue.click(screen.getByRole('checkbox', { name: label('guardian.authorize', names) }));
    await ue.click(screen.getByRole('button', { name: label('guardian.grant') }));
    expect(
      await screen.findByRole('heading', { level: 1, name: label('guardian.decided') }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: label('guardian.grant') })).not.toBeInTheDocument();
  });

  it('a 422 on a field is shown on that field (translated); a 423 as a form error', async () => {
    api.POST.mockResolvedValueOnce({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid',
        details: {
          issues: [{ path: ['guardianFirstName'], code: 'too_big', maximum: 80, origin: 'string' }],
        },
      },
    });
    const ue = userEvent.setup();
    renderWithIntl(<GuardianConsentForm token={TOKEN} preview={preview()} />);
    fillIdentity();
    await ue.click(screen.getByRole('checkbox', { name: label('guardian.authorize', names) }));
    await ue.click(screen.getByRole('button', { name: label('guardian.grant') }));
    await waitFor(() =>
      expect(screen.getByLabelText(label('guardian.firstName'))).toHaveAttribute(
        'aria-invalid',
        'true',
      ),
    );
    // `validation.too_big_string` (ICU plural) rendered for max = 80.
    expect(screen.getByText('Maximum 80 caractères.')).toBeInTheDocument();

    api.POST.mockResolvedValueOnce({
      error: { code: 'WORKSPACE_SUSPENDED', message: 'Suspended' },
      response: { status: 423 },
    });
    await ue.click(screen.getByRole('button', { name: label('guardian.grant') }));
    expect(await screen.findByText(tr('fr', 'errors.WORKSPACE_SUSPENDED'))).toBeInTheDocument();
  });

  it('renders right-to-left in Arabic', () => {
    renderWithIntl(<GuardianConsentForm token={TOKEN} preview={preview()} />, { locale: 'ar' });
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: tr('ar', 'guardian.grant') })).toBeInTheDocument();
  });
});
