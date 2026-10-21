import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CourseSummary, WorkspaceDetail } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockRouter, renderWithIntl, tr } from '../../test/render';
import { CoursesPanel } from './courses-panel';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('../../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';

const DETAIL: WorkspaceDetail = {
  id: 'w1',
  name: 'Espace de Mohamed',
  slug: 'm',
  type: 'PERSONAL',
  status: 'ACTIVE',
  country: 'TN',
  defaultTimezone: 'Africa/Tunis',
  defaultLocale: 'fr',
  allowPersonalWorkspaces: true,
  createdAt: '2026-10-01T08:00:00.000Z',
  myRole: 'OWNER',
  myCanTeach: true,
};

function course(id: string, title: string, extra: Partial<CourseSummary> = {}): CourseSummary {
  return {
    id,
    title,
    status: 'DRAFT',
    level: null,
    language: 'fr',
    category: null,
    coverUrl: null,
    ownerUserId: ME,
    owner: { firstName: 'Mohamed', lastName: 'Ben Ali' },
    estimatedMinutes: null,
    moduleCount: 2,
    lessonCount: 5,
    enrolledCount: 12,
    publishedAt: null,
    archivedAt: null,
    version: 1,
    createdAt: '2026-10-10T08:00:00.000Z',
    updatedAt: '2026-10-12T08:00:00.000Z',
    ...extra,
  };
}

const COURSES = [
  course('c1', 'Algèbre 1'),
  course('c2', 'Physique', { status: 'PUBLISHED', publishedAt: '2026-10-11T08:00:00.000Z' }),
];

function page(items: CourseSummary[]) {
  return { data: { items, nextCursor: null } };
}

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  api.GET.mockResolvedValue(page(COURSES));
});

describe('CoursesPanel', () => {
  it('lists the courses with status, counts and a link to each course', async () => {
    renderWithIntl(<CoursesPanel wid="w1" detail={DETAIL} meId={ME} />);
    const link = await screen.findByRole('link', { name: 'Algèbre 1' });
    expect(link).toHaveAttribute('href', '/app/w/w1/courses/c1');
    const row = link.closest('tr')!;
    expect(within(row).getByText(tr('fr', 'courses.status_DRAFT'))).toBeInTheDocument();
    expect(within(row).getByText('12')).toBeInTheDocument();
    expect(screen.getByText(tr('fr', 'courses.status_PUBLISHED'))).toBeInTheDocument();
    expect(api.GET).toHaveBeenCalledWith('/workspaces/{wid}/courses', {
      params: { path: { wid: 'w1' }, query: { limit: 100 } },
      signal: expect.any(AbortSignal),
    });
  });

  it('filters by status with the tabs', async () => {
    renderWithIntl(<CoursesPanel wid="w1" detail={DETAIL} meId={ME} />);
    await screen.findByRole('link', { name: 'Algèbre 1' });
    api.GET.mockResolvedValue(page([course('c3', 'Ancien cours', { status: 'ARCHIVED' })]));
    await userEvent
      .setup()
      .click(screen.getByRole('tab', { name: tr('fr', 'courses.tabArchived') }));
    expect(await screen.findByRole('link', { name: 'Ancien cours' })).toBeInTheDocument();
    expect(api.GET).toHaveBeenLastCalledWith('/workspaces/{wid}/courses', {
      params: { path: { wid: 'w1' }, query: { status: 'ARCHIVED', limit: 100 } },
      signal: expect.any(AbortSignal),
    });
  });

  it('shows the « Créez votre premier cours » empty state with the create action', async () => {
    api.GET.mockResolvedValue(page([]));
    renderWithIntl(<CoursesPanel wid="w1" detail={DETAIL} meId={ME} />);
    expect(
      await screen.findByRole('heading', { name: tr('fr', 'courses.emptyTitle') }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: tr('fr', 'courses.create') }).length).toBe(2);
  });

  it('has no create action on a suspended workspace', async () => {
    renderWithIntl(<CoursesPanel wid="w1" detail={{ ...DETAIL, status: 'SUSPENDED' }} meId={ME} />);
    await screen.findByRole('link', { name: 'Algèbre 1' });
    expect(screen.queryByRole('button', { name: tr('fr', 'courses.create') })).toBeNull();
  });

  it('creates a course from the dialog and opens it', async () => {
    const router = mockRouter();
    api.POST.mockResolvedValue({ data: { ...course('c9', 'Chimie'), version: 1 } });
    renderWithIntl(<CoursesPanel wid="w1" detail={DETAIL} meId={ME} />);
    await screen.findByRole('link', { name: 'Algèbre 1' });
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: tr('fr', 'courses.create') }));
    const dialog = await screen.findByRole('dialog', { name: tr('fr', 'courses.createTitle') });
    await ue.type(
      within(dialog).getByRole('textbox', { name: tr('fr', 'courses.fieldTitle') }),
      '  Chimie ',
    );
    await ue.selectOptions(
      within(dialog).getByRole('combobox', { name: tr('fr', 'courses.fieldLevel') }),
      'LYCEE',
    );
    await ue.click(
      within(dialog).getByRole('switch', { name: tr('fr', 'courses.fieldSequential') }),
    );
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'courses.createSubmit') }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/courses', {
        params: { path: { wid: 'w1' } },
        body: { title: 'Chimie', language: 'fr', level: 'LYCEE', sequentialLessons: true },
      }),
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/app/w/w1/courses/c9'));
  });

  it('shows a validation error of the title inline', async () => {
    api.POST.mockResolvedValue({
      error: {
        code: 'VALIDATION_FAILED',
        details: { issues: [{ path: ['title'], code: 'too_big', maximum: 200, origin: 'string' }] },
      },
    });
    renderWithIntl(<CoursesPanel wid="w1" detail={DETAIL} meId={ME} />);
    await screen.findByRole('link', { name: 'Algèbre 1' });
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: tr('fr', 'courses.create') }));
    const dialog = await screen.findByRole('dialog', { name: tr('fr', 'courses.createTitle') });
    const title = within(dialog).getByRole('textbox', { name: tr('fr', 'courses.fieldTitle') });
    await ue.type(title, 'Chimie');
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'courses.createSubmit') }));
    await waitFor(() => expect(title).toHaveAttribute('aria-invalid', 'true'));
    expect(title).toHaveFocus();
  });

  it('renders in Arabic (RTL)', async () => {
    renderWithIntl(<CoursesPanel wid="w1" detail={DETAIL} meId={ME} />, { locale: 'ar' });
    expect(await screen.findByRole('link', { name: 'Algèbre 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: tr('ar', 'courses.tabDraft') })).toBeInTheDocument();
  });
});
