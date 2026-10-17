import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Assignment, MemberSummary, MembershipRole, WorkspaceDetail } from '@tt/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../test/render';
import { MembersPanel } from './members-panel';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() }));
vi.mock('../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000002';
const TEACHER = 'aaaaaaaa-0000-4000-8000-000000000003';
const STUDENT = 'aaaaaaaa-0000-4000-8000-000000000004';
const UNKNOWN = 'aaaaaaaa-0000-4000-8000-0000009f3c21';

function member(
  userId: string,
  firstName: string,
  role: MembershipRole,
  extra: Partial<MemberSummary> = {},
): MemberSummary {
  return {
    userId,
    firstName,
    lastName: 'Test',
    email: `${firstName.toLowerCase()}@example.com`,
    role,
    canTeach: role !== 'STUDENT' && role !== 'TEACHER' ? false : role === 'TEACHER',
    status: 'ACTIVE',
    joinedAt: '2026-10-01T08:00:00.000Z',
    ...extra,
  };
}

const MEMBERS: MemberSummary[] = [
  member(OWNER, 'Amina', 'OWNER'),
  member(ADMIN, 'Karim', 'ADMIN'),
  member(TEACHER, 'Sara', 'TEACHER'),
  member(STUDENT, 'Yasmine', 'STUDENT'),
];

const ASSIGNMENTS: Assignment[] = [
  {
    id: 'as1',
    teacherUserId: TEACHER,
    studentUserId: STUDENT,
    assignedByUserId: OWNER,
    createdAt: '2026-10-02T08:00:00.000Z',
  },
  {
    id: 'as2',
    teacherUserId: TEACHER,
    studentUserId: UNKNOWN,
    assignedByUserId: OWNER,
    createdAt: '2026-10-03T08:00:00.000Z',
  },
];

function detail(
  myRole: MembershipRole,
  extra: Partial<Pick<WorkspaceDetail, 'status' | 'type'>> = {},
): WorkspaceDetail {
  return {
    id: 'w1',
    name: 'École Atlas',
    slug: 'ecole-atlas',
    type: extra.type ?? 'ORGANIZATION',
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

const ME: Record<'OWNER' | 'ADMIN' | 'TEACHER', string> = { OWNER, ADMIN, TEACHER };

function renderPanel(
  myRole: 'OWNER' | 'ADMIN' | 'TEACHER',
  locale: 'fr' | 'ar' = 'fr',
  extra: Partial<Pick<WorkspaceDetail, 'status' | 'type'>> = {},
) {
  return renderWithIntl(
    <MembersPanel wid="w1" detail={detail(myRole, extra)} meId={ME[myRole]} />,
    { locale },
  );
}

const fullName = (first: string) => `${first} Test`;
const rowActions = (first: string, locale: 'fr' | 'ar' = 'fr') =>
  tr(locale, 'members.rowActions').replace('{name}', fullName(first));

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.GET.mockImplementation(async (path: string) =>
    path === '/workspaces/{wid}/assignments'
      ? { data: { items: ASSIGNMENTS, nextCursor: null } }
      : { data: { items: MEMBERS, nextCursor: null } },
  );
  api.PATCH.mockResolvedValue({ data: {} });
  api.DELETE.mockResolvedValue({ data: undefined });
});

afterEach(() => {
  vi.useRealTimers();
});

async function openRowMenu(first: string) {
  const ue = userEvent.setup();
  await ue.click(await screen.findByRole('button', { name: rowActions(first) }));
  return { ue, menu: await screen.findByRole('menu') };
}

describe('MembersPanel', () => {
  it('hides role/remove actions for a TEACHER and shows them for an ADMIN', async () => {
    const { unmount } = renderPanel('TEACHER');
    const { menu } = await openRowMenu('Karim');
    expect(within(menu).getByRole('menuitem', { name: tr('fr', 'abuse.report') })).toBeVisible();
    expect(within(menu).queryByRole('menuitemradio')).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitemcheckbox')).not.toBeInTheDocument();
    expect(
      within(menu).queryByRole('menuitem', { name: tr('fr', 'members.remove') }),
    ).not.toBeInTheDocument();
    unmount();

    renderPanel('ADMIN');
    const { menu: adminMenu } = await openRowMenu('Sara');
    expect(
      within(adminMenu).getByRole('menuitemradio', { name: tr('fr', 'members.role_ADMIN') }),
    ).toBeInTheDocument();
    expect(
      within(adminMenu).getByRole('menuitem', { name: tr('fr', 'members.remove') }),
    ).toBeInTheDocument();
  });

  it('never offers to remove the OWNER or yourself', async () => {
    renderPanel('ADMIN');
    // Yourself: nothing to do on your own row (no role change, no removal, no self-report).
    await screen.findByTestId(`member-${ADMIN}`);
    expect(screen.queryByRole('button', { name: rowActions('Karim') })).not.toBeInTheDocument();
    // The OWNER: only *Signaler*.
    const { menu } = await openRowMenu('Amina');
    expect(within(menu).queryByRole('menuitemradio')).not.toBeInTheDocument();
    expect(
      within(menu).queryByRole('menuitem', { name: tr('fr', 'members.remove') }),
    ).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: tr('fr', 'abuse.report') })).toBeVisible();
  });

  it.each(['SUSPENDED', 'DELETING'] as const)(
    'offers no member write action in a %s workspace, only *Signaler*',
    async (status) => {
      api.POST.mockResolvedValue({ data: { id: 'r1', status: 'OPEN' } });
      renderPanel('OWNER', 'fr', { status });
      const { ue, menu } = await openRowMenu('Sara');
      expect(within(menu).queryByRole('menuitemradio')).not.toBeInTheDocument();
      expect(within(menu).queryByRole('menuitemcheckbox')).not.toBeInTheDocument();
      expect(
        within(menu).queryByRole('menuitem', { name: tr('fr', 'members.remove') }),
      ).not.toBeInTheDocument();
      // The workspace queue refuses writes (423): the report goes to the account-level queue.
      await ue.click(within(menu).getByRole('menuitem', { name: tr('fr', 'abuse.report') }));
      await ue.type(
        await screen.findByLabelText(tr('fr', 'abuse.description')),
        'Insultes répétées en séance',
      );
      await ue.click(screen.getByRole('button', { name: tr('fr', 'abuse.submit') }));
      await waitFor(() =>
        expect(api.POST).toHaveBeenCalledWith('/abuse-reports', {
          body: expect.objectContaining({ entityType: 'USER', entityId: TEACHER }),
        }),
      );
    },
  );

  it('derives the gates from the permission matrix (PERSONAL owner: remove a student only)', async () => {
    renderPanel('OWNER', 'fr', { type: 'PERSONAL' });
    // `student.remove` is granted to a personal owner, `workspace.staff.manage` is not.
    const { ue, menu } = await openRowMenu('Yasmine');
    expect(
      within(menu).getByRole('menuitem', { name: tr('fr', 'members.remove') }),
    ).toBeInTheDocument();
    await ue.keyboard('{Escape}');
    const { menu: staffMenu } = await openRowMenu('Karim');
    expect(within(staffMenu).queryByRole('menuitemradio')).not.toBeInTheDocument();
    expect(within(staffMenu).queryByRole('menuitemcheckbox')).not.toBeInTheDocument();
    expect(
      within(staffMenu).queryByRole('menuitem', { name: tr('fr', 'members.remove') }),
    ).not.toBeInTheDocument();
  });

  it('confirms a removal in an alert dialog before calling the API', async () => {
    renderPanel('OWNER');
    const { ue, menu } = await openRowMenu('Sara');
    await ue.click(within(menu).getByRole('menuitem', { name: tr('fr', 'members.remove') }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(
      tr('fr', 'members.confirmRemoveTitle').replace('{name}', fullName('Sara')),
    );
    expect(api.DELETE).not.toHaveBeenCalled();
    await ue.click(
      within(dialog).getByRole('button', {
        name: tr('fr', 'members.removeFor').replace('{name}', fullName('Sara')),
      }),
    );
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith('/workspaces/{wid}/members/{uid}', {
        params: { path: { wid: 'w1', uid: TEACHER } },
      }),
    );
  });

  it('returns focus to the row menu button when the removal is cancelled', async () => {
    renderPanel('OWNER');
    const { ue, menu } = await openRowMenu('Sara');
    await ue.click(within(menu).getByRole('menuitem', { name: tr('fr', 'members.remove') }));
    const dialog = await screen.findByRole('alertdialog');
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'common.cancel') }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: rowActions('Sara') })).toHaveFocus();
    expect(api.DELETE).not.toHaveBeenCalled();
  });

  it('renders a server 403 on a role change as a translated toast', async () => {
    api.PATCH.mockResolvedValue({
      error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
      response: { status: 403 },
    });
    renderPanel('ADMIN', 'ar');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: rowActions('Sara', 'ar') }));
    const menu = await screen.findByRole('menu');
    await ue.click(
      within(menu).getByRole('menuitemradio', { name: tr('ar', 'members.role_ADMIN') }),
    );
    expect(await screen.findByText(tr('ar', 'errors.PERMISSION_DENIED'))).toBeInTheDocument();
    expect(api.PATCH).toHaveBeenCalledWith('/workspaces/{wid}/members/{uid}', {
      params: { path: { wid: 'w1', uid: TEACHER } },
      body: { role: 'ADMIN' },
    });
  });

  it('debounces the search and keeps the latest response (sequence guard)', async () => {
    vi.useFakeTimers();
    const pending: Record<string, (value: unknown) => void> = {};
    api.GET.mockImplementation(
      (path: string, init: { params: { query: { q?: string } } }) =>
        new Promise((resolve) => {
          if (path === '/workspaces/{wid}/assignments') {
            resolve({ data: { items: [], nextCursor: null } });
            return;
          }
          const q = init.params.query.q ?? '';
          if (q === '') resolve({ data: { items: MEMBERS, nextCursor: null } });
          else pending[q] = resolve;
        }),
    );
    renderPanel('OWNER');
    await act(async () => {});
    expect(screen.getByTestId(`member-${TEACHER}`)).toBeInTheDocument();

    const search = screen.getByLabelText(tr('fr', 'members.search'));
    fireEvent.change(search, { target: { value: 'a' } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.change(search, { target: { value: 'ab' } });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    // Still inside the debounce window: no request for 'ab' yet.
    expect(pending.ab).toBeUndefined();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    const memberCalls = api.GET.mock.calls.filter(([path]) => path === '/workspaces/{wid}/members');
    expect(memberCalls.map(([, init]) => init.params.query.q ?? '')).toEqual(['', 'a', 'ab']);
    // The 'a' request was aborted when the key changed.
    expect((memberCalls[1]?.[1] as { signal: AbortSignal }).signal.aborted).toBe(true);

    await act(async () => {
      pending.ab?.({ data: { items: [MEMBERS[1]], nextCursor: null } });
    });
    await act(async () => {
      pending.a?.({ data: { items: [MEMBERS[2]], nextCursor: null } });
    });
    expect(screen.getByTestId(`member-${ADMIN}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`member-${TEACHER}`)).not.toBeInTheDocument();
  });

  it('shows an empty state when no member matches', async () => {
    api.GET.mockImplementation(async (path: string) =>
      path === '/workspaces/{wid}/assignments'
        ? { data: { items: [], nextCursor: null } }
        : { data: { items: [], nextCursor: null } },
    );
    renderPanel('OWNER');
    expect(await screen.findByText(tr('fr', 'members.noMatch'))).toBeInTheDocument();
  });

  it('renders assignment rows as "teacher enseigne à student" with names', async () => {
    renderPanel('OWNER');
    const list = await screen.findByTestId('assignments-list');
    const expected = tr('fr', 'members.assignmentOf')
      .replace('{teacher}', fullName('Sara'))
      .replace('{student}', fullName('Yasmine'));
    await waitFor(() => expect(list).toHaveTextContent(expected));
    expect(list.textContent).not.toMatch(/[→←]/);
    // An id with no loaded member falls back to a short id, the full one in `title`.
    const short = within(list).getByTitle(UNKNOWN);
    expect(short).toHaveTextContent('…9f3c21');
  });

  it('row action triggers have unique accessible names', async () => {
    renderPanel('OWNER');
    await screen.findByTestId(`member-${TEACHER}`);
    const triggers = screen.getAllByRole('button', {
      name: new RegExp(tr('fr', 'members.rowActions').replace('{name}', '.+')),
    });
    const names = triggers.map((el) => el.getAttribute('aria-label'));
    // Every row but your own (the OWNER) has a menu.
    expect(names).toHaveLength(MEMBERS.length - 1);
    expect(new Set(names).size).toBe(names.length);
    for (const first of ['Karim', 'Sara', 'Yasmine']) expect(names).toContain(rowActions(first));
  });
});
