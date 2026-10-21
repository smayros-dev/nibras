import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GrantContext, StudentProfile } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockRouter, renderWithIntl, tr } from '../test/render';
import { StudentProfilePanel } from './student-profile-panel';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const UID = 'aaaaaaaa-0000-4000-8000-000000000004';

const ADULT: StudentProfile = {
  user: {
    firstName: 'Yasmine',
    lastName: 'Trabelsi',
    email: 'yasmine@example.com',
    locale: 'ar',
    timezone: 'Africa/Tunis',
    isMinor: false,
  },
  membership: {
    status: 'ACTIVE',
    joinedAt: '2026-10-02T08:00:00.000Z',
    invitedBy: { firstName: 'Amina', lastName: 'Ben Ali' },
    removedAt: null,
  },
  guardian: null,
  assignedTeachers: [],
  courses: [],
  progress: null,
  sessions: [],
  attendance: null,
  reports: [],
  activity: [],
};

const MINOR: StudentProfile = {
  ...ADULT,
  user: { ...ADULT.user, firstName: 'Adam', isMinor: true },
  membership: { ...ADULT.membership, status: 'PENDING_GUARDIAN_CONSENT', joinedAt: null },
  guardian: {
    email: 'parent@example.com',
    emailMasked: 'p***@example.com',
    firstName: null,
    lastName: null,
    relationship: null,
    status: 'PENDING',
    grantedAt: null,
    consentExpiresAt: '2026-11-01T08:00:00.000Z',
    revokedAt: null,
  },
};

const OWNER_PERSONAL: GrantContext = { role: 'OWNER', canTeach: true, workspaceType: 'PERSONAL' };
const OWNER_ORG: GrantContext = { role: 'OWNER', canTeach: false, workspaceType: 'ORGANIZATION' };

function renderPanel(
  profile: StudentProfile,
  { grant = OWNER_PERSONAL, writable = true, locale = 'fr' as 'fr' | 'ar' } = {},
) {
  return renderWithIntl(
    <StudentProfilePanel wid="w1" uid={UID} profile={profile} grant={grant} writable={writable} />,
    { locale },
  );
}

const fill = (key: string, values: Record<string, string | number>) =>
  tr('fr', key).replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

const heading = (key: string, locale: 'fr' | 'ar' = 'fr') =>
  screen.getByRole('heading', { name: tr(locale, key) });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.POST.mockResolvedValue({ data: { status: 'PENDING' } });
  api.PATCH.mockResolvedValue({ data: { userId: UID } });
});

describe('StudentProfilePanel', () => {
  it('an adult: identity, membership and the empty sections with headings; no guardian card', () => {
    renderPanel(ADULT);
    expect(screen.getByRole('heading', { name: 'Yasmine Trabelsi' })).toBeInTheDocument();
    expect(heading('students.profile.identity')).toBeInTheDocument();
    expect(screen.getByText('yasmine@example.com')).toBeInTheDocument();
    expect(screen.getByText('Africa/Tunis')).toBeInTheDocument();
    expect(heading('students.profile.membership')).toBeInTheDocument();
    expect(screen.getByText('Amina Ben Ali')).toBeInTheDocument();
    expect(screen.queryByText(tr('fr', 'students.profile.minor'))).not.toBeInTheDocument();
    // Adults have no guardian card.
    expect(
      screen.queryByRole('heading', { name: tr('fr', 'students.profile.guardian') }),
    ).not.toBeInTheDocument();
    // The sections later sub-projects fill are present, empty, and name the feature.
    for (const [title, soon] of [
      ['courses', 'coursesSoon'],
      ['sessions', 'sessionsSoon'],
      ['reports', 'reportsSoon'],
      ['activity', 'activitySoon'],
    ] as const) {
      expect(heading(`students.profile.${title}`)).toBeInTheDocument();
      expect(screen.getByText(tr('fr', `students.profile.${soon}`))).toBeInTheDocument();
    }
    // A personal workspace has no assigned teachers section.
    expect(
      screen.queryByRole('heading', { name: tr('fr', 'students.profile.teachers') }),
    ).not.toBeInTheDocument();
    // The breadcrumb leads back to the students page.
    expect(screen.getByRole('link', { name: tr('fr', 'workspace.navStudents') })).toHaveAttribute(
      'href',
      '/app/w/w1/students',
    );
  });

  it('a minor: the Mineur badge and the guardian card with its status', () => {
    renderPanel(MINOR);
    expect(screen.getByText(tr('fr', 'students.profile.minor'))).toBeInTheDocument();
    const card = screen.getByRole('region', { name: tr('fr', 'students.profile.guardian') });
    expect(within(card).getByText('parent@example.com')).toBeInTheDocument();
    expect(within(card).getByText(tr('fr', 'guardian.status_PENDING'))).toBeInTheDocument();
  });

  it('shows the masked guardian email when the full one is withheld (Q7)', () => {
    renderPanel({ ...MINOR, guardian: { ...MINOR.guardian!, email: undefined } });
    const card = screen.getByRole('region', { name: tr('fr', 'students.profile.guardian') });
    expect(within(card).getByText('p***@example.com')).toBeInTheDocument();
  });

  it('Renvoyer la demande posts the resend and refreshes; a 429 toasts the minutes left', async () => {
    const router = mockRouter();
    renderPanel(MINOR);
    const ue = userEvent.setup();
    const resend = screen.getByRole('button', { name: tr('fr', 'students.profile.resendConsent') });
    await ue.click(resend);
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/workspaces/{wid}/students/{uid}/guardian/resend-consent',
        { params: { path: { wid: 'w1', uid: UID } } },
      ),
    );
    expect(await screen.findByText(tr('fr', 'students.consentResent'))).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();

    api.POST.mockResolvedValue({
      error: { code: 'RATE_LIMITED', message: 'x', details: { retryAfterS: 300 } },
    });
    await ue.click(resend);
    expect(await screen.findByText(fill('students.retryIn', { min: 5 }))).toBeInTheDocument();
  });

  it('Modifier l’email opens a dialog that patches the guardian email', async () => {
    const router = mockRouter();
    renderPanel(MINOR);
    const ue = userEvent.setup();
    await ue.click(
      screen.getByRole('button', { name: tr('fr', 'students.profile.editGuardianEmail') }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: fill('students.profile.editGuardianTitle', { name: 'Adam Trabelsi' }),
    });
    const input = within(dialog).getByRole('textbox', {
      name: tr('fr', 'students.profile.guardianEmail'),
    });
    expect(input).toHaveValue('parent@example.com');
    await ue.clear(input);
    await ue.type(input, ' Maman@Example.com ');
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'invitations.save') }));
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith('/workspaces/{wid}/students/{uid}', {
        params: { path: { wid: 'w1', uid: UID } },
        body: { guardianEmail: 'maman@example.com' },
      }),
    );
    expect(
      await screen.findByText(tr('fr', 'students.profile.guardianEmailSaved')),
    ).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('409 CONSENT_ALREADY_DECIDED keeps the dialog open with a translated alert', async () => {
    api.PATCH.mockResolvedValue({ error: { code: 'CONSENT_ALREADY_DECIDED', message: 'x' } });
    renderPanel(MINOR);
    const ue = userEvent.setup();
    await ue.click(
      screen.getByRole('button', { name: tr('fr', 'students.profile.editGuardianEmail') }),
    );
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('textbox', {
      name: tr('fr', 'students.profile.guardianEmail'),
    });
    await ue.clear(input);
    await ue.type(input, 'autre@example.com');
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'invitations.save') }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      tr('fr', 'errors.CONSENT_ALREADY_DECIDED'),
    );
  });

  it('a granted consent offers neither resend nor edit; a read-only workspace offers no action', () => {
    const { unmount } = renderPanel({
      ...MINOR,
      membership: { ...MINOR.membership, status: 'ACTIVE' },
      guardian: { ...MINOR.guardian!, status: 'ACTIVE', grantedAt: '2026-10-03T08:00:00.000Z' },
    });
    expect(
      screen.queryByRole('button', { name: tr('fr', 'students.profile.resendConsent') }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: tr('fr', 'students.profile.editGuardianEmail') }),
    ).not.toBeInTheDocument();
    unmount();

    renderPanel(MINOR, { writable: false });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('an organisation lists the assigned teachers (RTL in ar)', () => {
    renderPanel(
      {
        ...ADULT,
        assignedTeachers: [{ userId: 't1', firstName: 'Sara', lastName: 'Haddad' }],
      },
      { grant: OWNER_ORG, locale: 'ar' },
    );
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    const card = screen.getByRole('region', { name: tr('ar', 'students.profile.teachers') });
    expect(within(card).getByText('Sara Haddad')).toBeInTheDocument();
  });
});
