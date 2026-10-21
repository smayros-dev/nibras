import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StudentSummary } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../../test/render';
import { AssignStudentsDialog } from './assign-students-dialog';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('../../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const YASMINE = 'aaaaaaaa-0000-4000-8000-000000000011';
const OMAR = 'aaaaaaaa-0000-4000-8000-000000000012';
const LINA = 'aaaaaaaa-0000-4000-8000-000000000013';
const SAMI = 'aaaaaaaa-0000-4000-8000-000000000014';
const NOUR = 'aaaaaaaa-0000-4000-8000-000000000015';

function student(
  userId: string,
  firstName: string,
  extra: Partial<StudentSummary> = {},
): StudentSummary {
  return {
    userId,
    firstName,
    lastName: 'Test',
    email: undefined,
    status: 'ACTIVE',
    joinedAt: '2026-10-01T08:00:00.000Z',
    invitedByUserId: null,
    isMinor: false,
    guardian: null,
    progressPercent: null,
    attendanceRate: null,
    lastActivityAt: null,
    courses: [],
    ...extra,
  };
}

const STUDENTS = [
  student(YASMINE, 'Yasmine'),
  student(OMAR, 'Omar'),
  student(LINA, 'Lina', { status: 'PENDING_GUARDIAN_CONSENT', isMinor: true }),
  // Not assignable: waiting on approval, or already enrolled.
  student(SAMI, 'Sami', { status: 'PENDING_APPROVAL' }),
  student(NOUR, 'Nour'),
];

const fill = (key: string, values: Record<string, string | number>) =>
  tr('fr', key).replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

const onAssigned = vi.fn();
const onOpenChange = vi.fn();

function renderDialog() {
  return renderWithIntl(
    <AssignStudentsDialog
      wid="w1"
      courseId="c1"
      courseTitle="Algèbre 1"
      enrolledIds={[NOUR]}
      open
      onOpenChange={onOpenChange}
      onAssigned={onAssigned}
    />,
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  onAssigned.mockReset();
  onOpenChange.mockReset();
  api.GET.mockResolvedValue({ data: { items: STUDENTS, nextCursor: null } });
  api.POST.mockResolvedValue({
    data: { items: [{ studentUserId: YASMINE, status: 'ACTIVE', created: true }] },
  });
});

describe('AssignStudentsDialog', () => {
  it('lists the assignable students only and searches through the API', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog', {
      name: fill('enrollments.assignTitle', { title: 'Algèbre 1' }),
    });
    expect(await within(dialog).findByRole('checkbox', { name: /Yasmine Test/ })).toBeVisible();
    expect(within(dialog).getByRole('checkbox', { name: /Lina Test/ })).toBeVisible();
    // A guardian-pending student is pre-assigned: the hint says the course opens on consent.
    expect(within(dialog).getByText(tr('fr', 'enrollments.consentPending'))).toBeVisible();
    expect(within(dialog).queryByText(/Sami Test/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Nour Test/)).not.toBeInTheDocument();

    await userEvent
      .setup()
      .type(within(dialog).getByLabelText(tr('fr', 'enrollments.search')), 'yas');
    await waitFor(() =>
      expect(api.GET).toHaveBeenLastCalledWith(
        '/workspaces/{wid}/students',
        expect.objectContaining({
          params: expect.objectContaining({
            path: { wid: 'w1' },
            query: expect.objectContaining({ q: 'yas' }),
          }),
        }),
      ),
    );
  });

  it('selects students, shows the count and posts their ids', async () => {
    renderDialog();
    const ue = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', {
      name: tr('fr', 'enrollments.assignSubmit'),
    });
    expect(submit).toBeDisabled();
    await ue.click(await within(dialog).findByRole('checkbox', { name: /Yasmine Test/ }));
    await ue.click(within(dialog).getByRole('checkbox', { name: /Lina Test/ }));
    expect(within(dialog).getByText(fill('enrollments.selected', { count: 2 }))).toBeVisible();
    await ue.click(submit);
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/courses/{cid}/enrollments', {
        params: { path: { wid: 'w1', cid: 'c1' } },
        body: { studentUserIds: [YASMINE, LINA] },
      }),
    );
    expect(onAssigned).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(await screen.findByText(fill('enrollments.assigned', { count: 2 }))).toBeVisible();
  });

  it('maps a 422 on studentUserIds[i] to the row of that student and stays open', async () => {
    api.POST.mockResolvedValue({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: {
          issues: [{ path: ['studentUserIds', 1], message: 'Not a student assigned to you' }],
        },
      },
    });
    renderDialog();
    const ue = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await ue.click(await within(dialog).findByRole('checkbox', { name: /Yasmine Test/ }));
    await ue.click(within(dialog).getByRole('checkbox', { name: /Omar Test/ }));
    await ue.click(
      within(dialog).getByRole('button', { name: tr('fr', 'enrollments.assignSubmit') }),
    );
    expect(await within(dialog).findByText(tr('fr', 'enrollments.refused'))).toBeVisible();
    const omar = within(dialog).getByRole('checkbox', { name: /Omar Test/ });
    expect(omar).toHaveAccessibleDescription(tr('fr', 'enrollments.rowRefused'));
    expect(
      within(dialog).getByRole('checkbox', { name: /Yasmine Test/ }),
    ).not.toHaveAccessibleDescription(tr('fr', 'enrollments.rowRefused'));
    expect(onAssigned).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('a 409 on an archived course is shown as the form error', async () => {
    api.POST.mockResolvedValue({
      error: { code: 'COURSE_STATUS_INVALID', message: 'x', details: { status: 'ARCHIVED' } },
    });
    renderDialog();
    const ue = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await ue.click(await within(dialog).findByRole('checkbox', { name: /Yasmine Test/ }));
    await ue.click(
      within(dialog).getByRole('button', { name: tr('fr', 'enrollments.assignSubmit') }),
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      tr('fr', 'errors.COURSE_STATUS_INVALID'),
    );
  });
});
