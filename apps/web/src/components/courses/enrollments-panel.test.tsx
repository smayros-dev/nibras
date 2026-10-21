import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CourseDetail, EnrollmentSummary } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../../test/render';
import { EnrollmentsPanel } from './enrollments-panel';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() }));
vi.mock('../../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const YASMINE = 'aaaaaaaa-0000-4000-8000-000000000011';
const OMAR = 'aaaaaaaa-0000-4000-8000-000000000012';

function course(extra: Partial<CourseDetail> = {}): CourseDetail {
  return {
    id: 'c1',
    title: 'Algèbre 1',
    status: 'PUBLISHED',
    level: null,
    language: 'fr',
    category: null,
    coverUrl: null,
    ownerUserId: 'me',
    owner: { firstName: 'Mohamed', lastName: 'Ben Ali' },
    estimatedMinutes: null,
    moduleCount: 1,
    lessonCount: 1,
    enrolledCount: 1,
    publishedAt: '2026-10-12T08:00:00.000Z',
    archivedAt: null,
    version: 3,
    createdAt: '2026-10-10T08:00:00.000Z',
    updatedAt: '2026-10-12T08:00:00.000Z',
    description: null,
    estimatedMinutesOverride: null,
    coverMediaId: null,
    sequentialLessons: false,
    isCertifying: false,
    deletedAt: null,
    canPublish: true,
    publishBlockers: [],
    ...extra,
  };
}

function enrollment(
  studentUserId: string,
  firstName: string,
  extra: Partial<EnrollmentSummary> = {},
): EnrollmentSummary {
  return {
    studentUserId,
    firstName,
    lastName: 'Test',
    status: 'ACTIVE',
    source: 'MANUAL',
    activatedAt: '2026-10-15T08:00:00.000Z',
    revokedAt: null,
    progressPercent: 0,
    completedAt: null,
    lastActivityAt: null,
    ...extra,
  };
}

const ROWS = [
  enrollment(YASMINE, 'Yasmine', { progressPercent: 40 }),
  enrollment(OMAR, 'Omar', { status: 'REVOKED', revokedAt: '2026-10-16T08:00:00.000Z' }),
];

const fill = (key: string, values: Record<string, string | number>) =>
  tr('fr', key).replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

const onChanged = vi.fn();

function renderPanel(c: CourseDetail = course(), writable = true) {
  return renderWithIntl(
    <EnrollmentsPanel wid="w1" course={c} writable={writable} onChanged={onChanged} />,
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  onChanged.mockReset();
  api.GET.mockImplementation(async (path: string) => {
    if (path === '/workspaces/{wid}/courses/{cid}/enrollments')
      return { data: { items: ROWS, nextCursor: null } };
    return { data: { items: [], nextCursor: null } };
  });
  api.DELETE.mockResolvedValue({ data: undefined });
});

describe('EnrollmentsPanel', () => {
  it('lists the enrolled students with status, progress and assignment date', async () => {
    renderPanel();
    const row = (await screen.findByText('Yasmine Test')).closest('tr')!;
    expect(within(row).getByText(tr('fr', 'enrollments.status_ACTIVE'))).toBeVisible();
    const bar = within(row).getByRole('progressbar', {
      name: fill('enrollments.progressOf', { name: 'Yasmine Test' }),
    });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(within(row).getByText(/15 oct\. 2026/)).toBeVisible();
    const revoked = screen.getByText('Omar Test').closest('tr')!;
    expect(within(revoked).getByText(tr('fr', 'enrollments.status_REVOKED'))).toBeVisible();
    // A revoked enrollment has nothing to remove.
    expect(
      within(revoked).queryByRole('button', {
        name: fill('enrollments.revokeConfirm', { name: 'Omar Test' }),
      }),
    ).not.toBeInTheDocument();
    expect(api.GET).toHaveBeenCalledWith(
      '/workspaces/{wid}/courses/{cid}/enrollments',
      expect.objectContaining({
        params: expect.objectContaining({ path: { wid: 'w1', cid: 'c1' } }),
      }),
    );
  });

  it('Retirer confirms first, then revokes and reloads', async () => {
    renderPanel();
    const ue = userEvent.setup();
    await ue.click(
      await screen.findByRole('button', {
        name: fill('enrollments.revokeConfirm', { name: 'Yasmine Test' }),
      }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(
        fill('enrollments.revokeTitle', { name: 'Yasmine Test', title: 'Algèbre 1' }),
      ),
    ).toBeVisible();
    expect(api.DELETE).not.toHaveBeenCalled();
    const calls = api.GET.mock.calls.length;
    await ue.click(
      within(dialog).getByRole('button', {
        name: fill('enrollments.revokeConfirm', { name: 'Yasmine Test' }),
      }),
    );
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith('/workspaces/{wid}/courses/{cid}/enrollments/{uid}', {
        params: { path: { wid: 'w1', cid: 'c1', uid: YASMINE } },
        body: {},
      }),
    );
    expect(await screen.findByText(tr('fr', 'enrollments.revoked'))).toBeInTheDocument();
    await waitFor(() => expect(api.GET.mock.calls.length).toBeGreaterThan(calls));
    expect(onChanged).toHaveBeenCalled();
  });

  it('« Attribuer » opens the assign dialog (mounted on the first click)', async () => {
    renderPanel();
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: tr('fr', 'enrollments.assign') }));
    expect(
      await screen.findByRole('dialog', {
        name: fill('enrollments.assignTitle', { title: 'Algèbre 1' }),
      }),
    ).toBeVisible();
  });

  it('an ARCHIVED course takes no new assignment', async () => {
    renderPanel(course({ status: 'ARCHIVED' }));
    expect(await screen.findByText(tr('fr', 'enrollments.archivedNoAssign'))).toBeVisible();
    expect(
      screen.queryByRole('button', { name: tr('fr', 'enrollments.assign') }),
    ).not.toBeInTheDocument();
    // Removing stays possible.
    expect(
      screen.getByRole('button', {
        name: fill('enrollments.revokeConfirm', { name: 'Yasmine Test' }),
      }),
    ).toBeVisible();
  });

  it('a read-only workspace offers no write action', async () => {
    renderPanel(course(), false);
    expect(await screen.findByText('Yasmine Test')).toBeVisible();
    expect(screen.queryByRole('button', { name: tr('fr', 'enrollments.assign') })).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: fill('enrollments.revokeConfirm', { name: 'Yasmine Test' }),
      }),
    ).toBeNull();
  });

  it('an empty course shows the empty state with the assign action', async () => {
    api.GET.mockResolvedValue({ data: { items: [], nextCursor: null } });
    renderPanel();
    expect(
      await screen.findByRole('heading', { name: tr('fr', 'enrollments.emptyTitle') }),
    ).toBeVisible();
    expect(screen.getAllByRole('button', { name: tr('fr', 'enrollments.assign') }).length).toBe(1);
  });

  it('renders right to left in Arabic', async () => {
    renderWithIntl(<EnrollmentsPanel wid="w1" course={course()} writable onChanged={onChanged} />, {
      locale: 'ar',
    });
    expect(await screen.findByText('Yasmine Test')).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
  });
});
