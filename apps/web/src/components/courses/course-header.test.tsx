import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CourseDetail } from '@nibras/contracts';
import type { GrantContext } from '@nibras/contracts/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockRouter, renderWithIntl, tr } from '../../test/render';
import { CourseHeader } from './course-header';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() }));
vi.mock('../../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';

const PERSONAL_OWNER: GrantContext = { role: 'OWNER', canTeach: true, workspaceType: 'PERSONAL' };
const ORG_ADMIN: GrantContext = { role: 'ADMIN', canTeach: false, workspaceType: 'ORGANIZATION' };
const ORG_TEACHER: GrantContext = {
  role: 'TEACHER',
  canTeach: false,
  workspaceType: 'ORGANIZATION',
};

function course(extra: Partial<CourseDetail> = {}): CourseDetail {
  return {
    id: 'c1',
    title: 'Algèbre 1',
    status: 'DRAFT',
    level: null,
    language: 'fr',
    category: null,
    coverUrl: null,
    ownerUserId: ME,
    owner: { firstName: 'Mohamed', lastName: 'Ben Ali' },
    estimatedMinutes: null,
    moduleCount: 1,
    lessonCount: 1,
    enrolledCount: 0,
    publishedAt: null,
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

const onChanged = vi.fn();

function renderHeader(
  c: CourseDetail,
  grant: GrantContext = PERSONAL_OWNER,
  { writable = true, locale = 'fr' as 'fr' | 'ar' } = {},
) {
  renderWithIntl(
    <CourseHeader
      wid="w1"
      meId={ME}
      course={c}
      grant={grant}
      writable={writable}
      onChanged={onChanged}
    />,
    { locale },
  );
}

async function menuItems() {
  await userEvent.setup().click(screen.getByRole('button', { name: tr('fr', 'courses.actions') }));
  const menu = await screen.findByRole('menu');
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent);
}

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  api.DELETE.mockReset();
  onChanged.mockReset();
});

describe('CourseHeader', () => {
  it('a DRAFT offers Publier and Supprimer; publishing reports the new course', async () => {
    const published = course({ status: 'PUBLISHED', version: 4 });
    api.POST.mockResolvedValue({ data: published });
    renderHeader(course());
    expect(screen.getByRole('heading', { name: 'Algèbre 1' })).toBeInTheDocument();
    expect(screen.getByText(tr('fr', 'courses.status_DRAFT'))).toBeInTheDocument();
    expect(await menuItems()).toEqual([tr('fr', 'courses.delete')]);
    await userEvent.setup().keyboard('{Escape}');
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: tr('fr', 'courses.publish') }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/courses/{cid}/publish', {
        params: { path: { wid: 'w1', cid: 'c1' } },
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(published));
  });

  it('Publier is disabled with the blockers listed when the course is not publishable', () => {
    renderHeader(course({ canPublish: false, publishBlockers: ['NO_MODULE', 'NO_READY_LESSON'] }));
    const publish = screen.getByRole('button', { name: tr('fr', 'courses.publish') });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription(new RegExp(tr('fr', 'courses.blocker_NO_MODULE')));
    expect(screen.getByText(tr('fr', 'courses.blocker_NO_READY_LESSON'))).toBeInTheDocument();
  });

  it('a PUBLISHED course offers Dépublier, Archiver and « Archiver puis supprimer »', async () => {
    renderHeader(course({ status: 'PUBLISHED' }));
    expect(screen.queryByRole('button', { name: tr('fr', 'courses.publish') })).toBeNull();
    expect(await menuItems()).toEqual([
      tr('fr', 'courses.unpublish'),
      tr('fr', 'courses.archive'),
      tr('fr', 'courses.archiveDelete'),
    ]);
  });

  it('an ARCHIVED course offers Restaurer and Supprimer', async () => {
    renderHeader(course({ status: 'ARCHIVED' }));
    expect(await menuItems()).toEqual([tr('fr', 'courses.restore'), tr('fr', 'courses.delete')]);
  });

  it('« Archiver puis supprimer » archives then deletes after one confirmation', async () => {
    const router = mockRouter();
    api.POST.mockResolvedValue({ data: course({ status: 'ARCHIVED', version: 4 }) });
    api.DELETE.mockResolvedValue({});
    renderHeader(course({ status: 'PUBLISHED' }));
    await menuItems();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('menuitem', { name: tr('fr', 'courses.archiveDelete') }));
    const confirm = await screen.findByRole('alertdialog');
    await ue.click(
      within(confirm).getByRole('button', { name: tr('fr', 'courses.archiveDelete') }),
    );
    await waitFor(() => expect(api.DELETE).toHaveBeenCalled());
    expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/courses/{cid}/archive', {
      params: { path: { wid: 'w1', cid: 'c1' } },
    });
    expect(api.DELETE).toHaveBeenCalledWith('/workspaces/{wid}/courses/{cid}', {
      params: { path: { wid: 'w1', cid: 'c1' } },
    });
    expect(api.POST.mock.invocationCallOrder[0]!).toBeLessThan(
      api.DELETE.mock.invocationCallOrder[0]!,
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/app/w/w1/courses'));
  });

  it('a refused delete after the archive keeps the archived course and says why', async () => {
    const archived = course({ status: 'ARCHIVED', version: 4 });
    api.POST.mockResolvedValue({ data: archived });
    api.DELETE.mockResolvedValue({ error: { code: 'COURSE_HAS_ACTIVE_ENROLLMENTS' } });
    renderHeader(course({ status: 'PUBLISHED' }));
    await menuItems();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('menuitem', { name: tr('fr', 'courses.archiveDelete') }));
    const confirm = await screen.findByRole('alertdialog');
    await ue.click(
      within(confirm).getByRole('button', { name: tr('fr', 'courses.archiveDelete') }),
    );
    expect(
      await screen.findByText(tr('fr', 'errors.COURSE_HAS_ACTIVE_ENROLLMENTS')),
    ).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledWith(archived);
  });

  it('Réaffecter is for an organisation ADMIN, not for the TEACHER (scope own)', async () => {
    renderHeader(course(), ORG_ADMIN);
    expect(await menuItems()).toContain(tr('fr', 'courses.reassign'));
  });

  it('an organisation TEACHER manages his own course without Réaffecter', async () => {
    renderHeader(course(), ORG_TEACHER);
    expect(await menuItems()).toEqual([tr('fr', 'courses.delete')]);
  });

  it('an organisation TEACHER has no action on a course he does not own', () => {
    renderHeader(course({ ownerUserId: OTHER }), ORG_TEACHER);
    expect(screen.queryByRole('button', { name: tr('fr', 'courses.actions') })).toBeNull();
    expect(screen.queryByRole('button', { name: tr('fr', 'courses.publish') })).toBeNull();
  });

  it('no write action on a suspended workspace', () => {
    renderHeader(course(), PERSONAL_OWNER, { writable: false });
    expect(screen.queryByRole('button', { name: tr('fr', 'courses.actions') })).toBeNull();
    expect(screen.queryByRole('button', { name: tr('fr', 'courses.publish') })).toBeNull();
  });

  it('renders in Arabic', () => {
    renderHeader(course(), PERSONAL_OWNER, { locale: 'ar' });
    expect(screen.getByRole('button', { name: tr('ar', 'courses.publish') })).toBeInTheDocument();
  });
});
