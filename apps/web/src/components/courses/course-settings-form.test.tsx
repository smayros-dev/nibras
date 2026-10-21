import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CourseDetail } from '@nibras/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../../test/render';
import { CourseSettingsForm } from './course-settings-form';

const api = vi.hoisted(() => ({ GET: vi.fn(), PATCH: vi.fn() }));
vi.mock('../../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

function course(extra: Partial<CourseDetail> = {}): CourseDetail {
  return {
    id: 'c1',
    title: 'Algèbre 1',
    status: 'DRAFT',
    level: 'COLLEGE',
    language: 'fr',
    category: null,
    coverUrl: null,
    ownerUserId: 'u1',
    owner: { firstName: 'Mohamed', lastName: 'Ben Ali' },
    estimatedMinutes: null,
    moduleCount: 0,
    lessonCount: 0,
    enrolledCount: 0,
    publishedAt: null,
    archivedAt: null,
    version: 3,
    createdAt: '2026-10-10T08:00:00.000Z',
    updatedAt: '2026-10-12T08:00:00.000Z',
    description: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Les bases.' }] }],
    },
    estimatedMinutesOverride: null,
    coverMediaId: null,
    sequentialLessons: false,
    isCertifying: false,
    deletedAt: null,
    canPublish: false,
    publishBlockers: ['NO_MODULE'],
    ...extra,
  };
}

const onChanged = vi.fn();
const onReload = vi.fn();

function renderForm(c: CourseDetail = course(), locale: 'fr' | 'ar' = 'fr') {
  renderWithIntl(
    <CourseSettingsForm wid="w1" course={c} writable onChanged={onChanged} onReload={onReload} />,
    { locale },
  );
}

const titleBox = () => screen.getByRole('textbox', { name: tr('fr', 'courses.fieldTitle') });
const save = () => screen.getByRole('button', { name: tr('fr', 'courses.save') });

beforeEach(() => {
  api.GET.mockReset();
  api.PATCH.mockReset();
  onChanged.mockReset();
  onReload.mockReset();
});

describe('CourseSettingsForm', () => {
  it('shows the course and saves the changed fields with If-Match', async () => {
    const saved = course({ title: 'Algèbre 2', version: 4 });
    api.PATCH.mockResolvedValue({ data: saved });
    renderForm();
    expect(titleBox()).toHaveValue('Algèbre 1');
    expect(
      await screen.findByRole('textbox', { name: tr('fr', 'courses.fieldDescription') }),
    ).toHaveTextContent('Les bases.');
    const ue = userEvent.setup();
    await ue.clear(titleBox());
    await ue.type(titleBox(), 'Algèbre 2');
    await ue.click(save());
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith('/workspaces/{wid}/courses/{cid}', {
        params: { path: { wid: 'w1', cid: 'c1' }, header: { 'If-Match': '"3"' } },
        body: { title: 'Algèbre 2' },
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(saved));
  });

  it('sends the description as a rich-text document and an empty duration as null', async () => {
    api.PATCH.mockResolvedValue({ data: course({ version: 4 }) });
    renderForm(course({ estimatedMinutesOverride: 90 }));
    const ue = userEvent.setup();
    const description = await screen.findByRole('textbox', {
      name: tr('fr', 'courses.fieldDescription'),
    });
    await ue.click(description);
    await ue.keyboard('{Control>}a{/Control}Ligne 1{Enter}Ligne 2');
    await ue.clear(screen.getByRole('spinbutton', { name: tr('fr', 'courses.fieldEstimated') }));
    await ue.click(save());
    await waitFor(() => expect(api.PATCH).toHaveBeenCalled());
    expect(api.PATCH.mock.calls[0]![1].body).toEqual({
      description: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Ligne 1' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Ligne 2' }] },
        ],
      },
      estimatedMinutes: null,
    });
  });

  it('409 VERSION_CONFLICT opens the conflict dialog; « Écraser » re-sends with the current version (AC-CRS-03)', async () => {
    const saved = course({ title: 'Mon titre', version: 6 });
    api.PATCH.mockResolvedValueOnce({
      error: { code: 'VERSION_CONFLICT', details: { currentVersion: 5 } },
    }).mockResolvedValueOnce({ data: saved });
    renderForm();
    const ue = userEvent.setup();
    await ue.clear(titleBox());
    await ue.type(titleBox(), 'Mon titre');
    await ue.click(save());
    const dialog = await screen.findByRole('alertdialog', {
      name: tr('fr', 'courses.conflictTitle'),
    });
    await ue.click(
      within(dialog).getByRole('button', { name: tr('fr', 'courses.conflictOverwrite') }),
    );
    await waitFor(() => expect(api.PATCH).toHaveBeenCalledTimes(2));
    expect(api.PATCH.mock.calls[1]![1]).toEqual({
      params: { path: { wid: 'w1', cid: 'c1' }, header: { 'If-Match': '"5"' } },
      body: { title: 'Mon titre' },
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(saved));
  });

  it('« Recharger » reloads the course and drops the local edits', async () => {
    api.PATCH.mockResolvedValue({
      error: { code: 'VERSION_CONFLICT', details: { currentVersion: 5 } },
    });
    onReload.mockResolvedValue(course({ title: 'Titre distant', version: 5 }));
    renderForm();
    const ue = userEvent.setup();
    await ue.clear(titleBox());
    await ue.type(titleBox(), 'Mon titre');
    await ue.click(save());
    const dialog = await screen.findByRole('alertdialog');
    await ue.click(
      within(dialog).getByRole('button', { name: tr('fr', 'courses.conflictReload') }),
    );
    await waitFor(() => expect(titleBox()).toHaveValue('Titre distant'));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(api.PATCH).toHaveBeenCalledTimes(1);
  });

  it('maps validation issues to the fields and focuses the first one', async () => {
    api.PATCH.mockResolvedValue({
      error: {
        code: 'VALIDATION_FAILED',
        details: { issues: [{ path: ['title'], code: 'too_small', minimum: 1, origin: 'string' }] },
      },
    });
    renderForm();
    const ue = userEvent.setup();
    await ue.clear(titleBox());
    await ue.type(titleBox(), ' ');
    await ue.click(save());
    await waitFor(() => expect(titleBox()).toHaveAttribute('aria-invalid', 'true'));
    expect(titleBox()).toHaveFocus();
  });

  it('renders in Arabic', () => {
    renderForm(course(), 'ar');
    expect(screen.getByRole('button', { name: tr('ar', 'courses.save') })).toBeInTheDocument();
  });
});
