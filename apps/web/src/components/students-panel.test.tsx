import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  InvitationSummary,
  MembershipRole,
  StudentSummary,
  WorkspaceDetail,
} from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../test/render';
import { StudentsPanel } from './students-panel';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const YASMINE = 'aaaaaaaa-0000-4000-8000-000000000011';
const OMAR = 'aaaaaaaa-0000-4000-8000-000000000012';
const LINA = 'aaaaaaaa-0000-4000-8000-000000000013';

function student(
  userId: string,
  firstName: string,
  extra: Partial<StudentSummary> = {},
): StudentSummary {
  return {
    userId,
    firstName,
    lastName: 'Test',
    email: `${firstName.toLowerCase()}@example.com`,
    status: 'ACTIVE',
    joinedAt: '2026-10-01T08:00:00.000Z',
    invitedByUserId: ME,
    isMinor: false,
    guardian: null,
    progressPercent: null,
    attendanceRate: null,
    lastActivityAt: null,
    courses: [],
    ...extra,
  };
}

const STUDENTS: StudentSummary[] = [
  student(YASMINE, 'Yasmine'),
  student(OMAR, 'Omar', { status: 'PENDING_APPROVAL', joinedAt: null }),
  student(LINA, 'Lina', {
    status: 'PENDING_GUARDIAN_CONSENT',
    joinedAt: null,
    isMinor: true,
    guardian: {
      emailMasked: 'k***@example.com',
      status: 'PENDING',
      consentExpiresAt: '2026-11-01T08:00:00.000Z',
    },
  }),
];

const INVITATION: InvitationSummary = {
  id: 'inv1',
  email: 'nour@example.com',
  role: 'STUDENT',
  firstName: null,
  lastName: null,
  guardianEmail: null,
  status: 'PENDING',
  expiresAt: '2026-10-25T08:00:00.000Z',
  invitedByUserId: ME,
  invitedByName: 'Mohamed Ben Ali',
  teacherUserId: null,
  courseIds: [],
  resentCount: 0,
  lastSentAt: '2026-10-18T08:00:00.000Z',
  acceptedAt: null,
  revokedAt: null,
  createdAt: '2026-10-18T08:00:00.000Z',
};

function detail(
  myRole: MembershipRole,
  extra: Partial<Pick<WorkspaceDetail, 'status' | 'type'>> = {},
): WorkspaceDetail {
  return {
    id: 'w1',
    name: 'Espace de Mohamed',
    slug: 'espace-mohamed',
    type: extra.type ?? 'PERSONAL',
    status: extra.status ?? 'ACTIVE',
    country: 'TN',
    defaultTimezone: 'Africa/Tunis',
    defaultLocale: 'fr',
    allowPersonalWorkspaces: true,
    createdAt: '2026-10-01T08:00:00.000Z',
    myRole,
    myCanTeach: false,
  };
}

function mockLists(students: StudentSummary[], invitations: InvitationSummary[]) {
  api.GET.mockImplementation(
    async (path: string, opts?: { params?: { query?: Record<string, unknown> } }) => {
      const query = opts?.params?.query ?? {};
      if (path === '/workspaces/{wid}/students')
        return { data: { items: students, nextCursor: null } };
      if (path === '/workspaces/{wid}/invitations')
        return {
          data: {
            items: invitations.filter((i) => i.status === query.status),
            nextCursor: null,
          },
        };
      if (path === '/workspaces/{wid}/invite-links') return { data: [] };
      return { data: { items: [], nextCursor: null } };
    },
  );
}

function renderPanel(
  myRole: MembershipRole = 'OWNER',
  extra: Partial<Pick<WorkspaceDetail, 'status' | 'type'>> = {},
  initialTab: 'all' | 'pending' = 'all',
) {
  return renderWithIntl(
    <StudentsPanel wid="w1" detail={detail(myRole, extra)} meId={ME} initialTab={initialTab} />,
  );
}

const fill = (key: string, values: Record<string, string | number>) =>
  tr('fr', key).replace(/\{(\w+)\}/g, (_, k: string) => String(values[k]));

async function openRowMenu(first: string) {
  const ue = userEvent.setup();
  await ue.click(
    await screen.findByRole('button', {
      name: fill('students.rowActions', { name: `${first} Test` }),
    }),
  );
  return { ue, menu: await screen.findByRole('menu') };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  mockLists(STUDENTS, [INVITATION]);
  api.POST.mockResolvedValue({ data: {} });
  api.DELETE.mockResolvedValue({ data: undefined });
  window.history.replaceState(null, '', '/fr/app/w/w1/students');
});

describe('StudentsPanel', () => {
  it('Tous lists the active students; En attente merges pending-status students and pending invitations', async () => {
    renderPanel();
    expect(await screen.findByText('Yasmine Test')).toBeVisible();
    expect(
      await screen.findByRole('heading', { name: fill('students.title', { count: 4 }) }),
    ).toBeVisible();
    expect(screen.queryByText('Omar Test')).not.toBeInTheDocument();
    expect(screen.queryByText('nour@example.com')).not.toBeInTheDocument();

    const ue = userEvent.setup();
    await ue.click(screen.getByRole('tab', { name: tr('fr', 'students.tabPending') }));
    expect(await screen.findByText('Omar Test')).toBeVisible();
    expect(screen.getByText('Lina Test')).toBeVisible();
    expect(screen.getByText('nour@example.com')).toBeVisible();
    expect(screen.getByText(tr('fr', 'invitations.status_PENDING'))).toBeVisible();
    expect(screen.queryByText('Yasmine Test')).not.toBeInTheDocument();
    expect(window.location.search).toBe('?tab=pending');
    // The pending invitations are asked for the STUDENT role only.
    expect(api.GET).toHaveBeenCalledWith(
      '/workspaces/{wid}/invitations',
      expect.objectContaining({
        params: expect.objectContaining({
          query: expect.objectContaining({ status: 'PENDING', role: 'STUDENT' }),
        }),
      }),
    );
  });

  it('shows the guardian status and the masked address', async () => {
    renderPanel('OWNER', {}, 'pending');
    const row = (await screen.findByText('Lina Test')).closest('tr')!;
    expect(within(row).getByText(tr('fr', 'guardian.status_PENDING'))).toBeVisible();
    expect(within(row).getByText('k***@example.com')).toBeVisible();
  });

  it('names each row menu after the student; Approuver / Refuser only on PENDING_APPROVAL', async () => {
    renderPanel('OWNER', {}, 'pending');
    const { ue, menu } = await openRowMenu('Omar');
    expect(within(menu).getByRole('menuitem', { name: tr('fr', 'students.reject') })).toBeVisible();
    await ue.click(within(menu).getByRole('menuitem', { name: tr('fr', 'students.approve') }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/members/{uid}/approve', {
        params: { path: { wid: 'w1', uid: OMAR } },
      }),
    );
    expect(
      await screen.findByText(fill('students.approved', { name: 'Omar Test' })),
    ).toBeInTheDocument();

    const { menu: linaMenu } = await openRowMenu('Lina');
    expect(
      within(linaMenu).queryByRole('menuitem', { name: tr('fr', 'students.approve') }),
    ).not.toBeInTheDocument();
    expect(
      within(linaMenu).getByRole('menuitem', { name: tr('fr', 'students.resendConsent') }),
    ).toBeVisible();
  });

  it('Renvoyer au tuteur posts the resend; a 429 toasts the minutes left', async () => {
    api.POST.mockResolvedValueOnce({
      error: { code: 'RATE_LIMITED', message: 'x', details: { retryAfterS: 420 } },
    });
    renderPanel('OWNER', {}, 'pending');
    const { ue, menu } = await openRowMenu('Lina');
    await ue.click(
      within(menu).getByRole('menuitem', { name: tr('fr', 'students.resendConsent') }),
    );
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/workspaces/{wid}/students/{uid}/guardian/resend-consent',
        { params: { path: { wid: 'w1', uid: LINA } } },
      ),
    );
    expect(await screen.findByText(fill('students.retryIn', { min: 7 }))).toBeInTheDocument();
  });

  it('Retirer needs student.remove: an organisation TEACHER has none, the OWNER confirms first', async () => {
    const { unmount } = renderPanel('TEACHER', { type: 'ORGANIZATION' });
    const { menu } = await openRowMenu('Yasmine');
    expect(within(menu).getByRole('menuitem', { name: tr('fr', 'abuse.report') })).toBeVisible();
    expect(
      within(menu).queryByRole('menuitem', { name: tr('fr', 'students.remove') }),
    ).not.toBeInTheDocument();
    unmount();

    renderPanel('OWNER', { type: 'ORGANIZATION' });
    const { ue, menu: ownerMenu } = await openRowMenu('Yasmine');
    await ue.click(within(ownerMenu).getByRole('menuitem', { name: tr('fr', 'students.remove') }));
    const dialog = await screen.findByRole('alertdialog', {
      name: fill('students.removeTitle', { name: 'Yasmine Test' }),
    });
    expect(api.DELETE).not.toHaveBeenCalled();
    await ue.click(
      within(dialog).getByRole('button', {
        name: fill('students.removeConfirm', { name: 'Yasmine Test' }),
      }),
    );
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith('/workspaces/{wid}/members/{uid}', {
        params: { path: { wid: 'w1', uid: YASMINE } },
      }),
    );
  });

  it('an empty workspace shows the call to action, which opens the invite dialog', async () => {
    mockLists([], []);
    renderPanel();
    const empty = await screen.findByRole('heading', { name: tr('fr', 'students.emptyTitle') });
    const ue = userEvent.setup();
    await ue.click(
      within(empty.parentElement!).getByRole('button', { name: tr('fr', 'students.invite') }),
    );
    expect(
      await screen.findByRole('dialog', { name: tr('fr', 'invitations.inviteTitle') }),
    ).toBeVisible();
  });

  it('a suspended workspace offers no write action', async () => {
    renderPanel('OWNER', { status: 'SUSPENDED' }, 'pending');
    await screen.findByText('Omar Test');
    expect(
      screen.queryByRole('button', { name: tr('fr', 'students.invite') }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: tr('fr', 'students.importCsv') }),
    ).not.toBeInTheDocument();
    const { menu } = await openRowMenu('Omar');
    expect(
      within(menu).queryByRole('menuitem', { name: tr('fr', 'students.approve') }),
    ).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: tr('fr', 'abuse.report') })).toBeVisible();
  });

  it('Lien de groupe toggles the invite-link card', async () => {
    renderPanel();
    const ue = userEvent.setup();
    const toggle = await screen.findByRole('button', { name: tr('fr', 'students.groupLink') });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await ue.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      await screen.findByRole('heading', { name: tr('fr', 'inviteLinks.title') }),
    ).toBeVisible();
  });

  it('Importer CSV is enabled and opens the import dialog, loaded on demand', async () => {
    renderPanel();
    const ue = userEvent.setup();
    const button = await screen.findByRole('button', { name: tr('fr', 'students.importCsv') });
    expect(button).toBeEnabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await ue.click(button);
    expect(await screen.findByRole('dialog', { name: tr('fr', 'imports.title') })).toBeVisible();
  });
});
