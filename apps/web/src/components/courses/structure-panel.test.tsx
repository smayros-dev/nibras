import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CourseStructure, LessonSummary, MediaAssetView } from '@nibras/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl, tr } from '../../test/render';
import { StructurePanel } from './structure-panel';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() }));
vi.mock('../../lib/api', () => ({ api, asApiResult: (result: unknown) => result }));

function lesson(id: string, moduleId: string, extra: Partial<LessonSummary> = {}): LessonSummary {
  return {
    id,
    moduleId,
    title: `Leçon ${id}`,
    description: null,
    type: 'TEXT',
    position: 0,
    isRequired: true,
    estimatedMinutes: null,
    allowDownload: false,
    mediaAssetId: null,
    media: null,
    hasContent: true,
    version: 1,
    ...extra,
  };
}

function structure(extra: Partial<CourseStructure> = {}): CourseStructure {
  return {
    courseId: 'c1',
    version: 5,
    status: 'DRAFT',
    sequentialLessons: false,
    modules: [
      {
        id: 'm1',
        title: 'Les nombres',
        description: null,
        position: 0,
        isOptional: false,
        unlockRule: { type: 'NONE' },
        version: 1,
        lessons: [
          lesson('l1', 'm1'),
          lesson('l2', 'm1', {
            type: 'VIDEO',
            position: 1,
            mediaAssetId: 'a1',
            hasContent: false,
            media: {
              id: 'a1',
              kind: 'VIDEO',
              status: 'PROCESSING',
              failureReason: null,
              durationS: null,
              pageCount: null,
              width: null,
              height: null,
              thumbnailUrl: null,
            },
          }),
        ],
      },
      {
        id: 'm2',
        title: 'Les fractions',
        description: null,
        position: 1,
        isOptional: true,
        unlockRule: { type: 'PREVIOUS_MODULE_COMPLETED' },
        version: 1,
        lessons: [],
      },
    ],
    ...extra,
  };
}

function asset(status: MediaAssetView['status']): MediaAssetView {
  return {
    id: 'a1',
    kind: 'VIDEO',
    provider: 'S3',
    status,
    failureReason: null,
    originalFilename: 'intro.mp4',
    mimeType: 'video/mp4',
    sizeBytes: '1000',
    durationS: status === 'READY' ? 125 : null,
    width: null,
    height: null,
    pageCount: null,
    thumbnailUrl: null,
    ownerUserId: 'u1',
    uploadUrlExpiresAt: null,
    readyAt: null,
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
    usedBy: [],
  };
}

let mediaAnswers: MediaAssetView['status'][] = [];
const onCourseChanged = vi.fn();

beforeEach(() => {
  mediaAnswers = ['PROCESSING'];
  api.GET.mockReset();
  api.POST.mockReset();
  api.PATCH.mockReset();
  api.DELETE.mockReset();
  onCourseChanged.mockReset();
  api.GET.mockImplementation(async (path: string) => {
    if (path === '/workspaces/{wid}/courses/{cid}/structure') return { data: structure() };
    if (path === '/workspaces/{wid}/media/{mediaId}') {
      return { data: asset(mediaAnswers.shift() ?? 'PROCESSING') };
    }
    if (path === '/workspaces/{wid}/media') return { data: { items: [], nextCursor: null } };
    throw new Error(`unexpected GET ${path}`);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderPanel(locale: 'fr' | 'ar' = 'fr') {
  return renderWithIntl(
    <StructurePanel wid="w1" courseId="c1" writable onCourseChanged={onCourseChanged} />,
    { locale },
  );
}

/** jsdom lays nothing out: give each sortable row a stacked box so dnd-kit can measure it. */
function stackRows() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const index = Number(this.getAttribute('data-sortable-index') ?? -1);
    const top = index < 0 ? 0 : index * 60;
    const height = index < 0 ? 0 : 50;
    return {
      x: 0,
      y: top,
      top,
      left: 0,
      right: 300,
      bottom: top + height,
      width: index < 0 ? 0 : 300,
      height,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

describe('StructurePanel', () => {
  it('renders the modules with their lessons and media states', async () => {
    renderPanel();
    const modules = await screen.findByRole('list', { name: tr('fr', 'structure.modulesList') });
    const items = within(modules).getAllByRole('heading', { level: 4 });
    expect(items.map((h) => h.textContent)).toEqual(['Les nombres', 'Les fractions']);
    expect(screen.getByText('Leçon l1')).toBeInTheDocument();
    expect(screen.getByText(tr('fr', 'upload.status_PROCESSING'))).toBeInTheDocument();
    expect(screen.getByText(tr('fr', 'structure.optional'))).toBeInTheDocument();
    expect(screen.getByText(tr('fr', 'structure.unlockAfterPrevious'))).toBeInTheDocument();
    expect(screen.getByText(tr('fr', 'structure.noLessons'))).toBeInTheDocument();
  });

  it('reorders modules with the keyboard (Space, ArrowDown, Space) and posts the order with If-Match', async () => {
    stackRows();
    api.POST.mockResolvedValue({ data: structure() });
    renderPanel();
    const handle = await screen.findByRole('button', {
      name: tr('fr', 'structure.dragHandle').replace('{title}', 'Les nombres'),
    });
    handle.focus();
    const ue = userEvent.setup();
    await ue.keyboard(' ');
    await ue.keyboard('{ArrowDown}');
    await ue.keyboard(' ');
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/courses/{cid}/modules/reorder', {
        params: { path: { wid: 'w1', cid: 'c1' }, header: { 'If-Match': '"5"' } },
        body: { ids: ['m2', 'm1'] },
      }),
    );
    await waitFor(() => expect(onCourseChanged).toHaveBeenCalled());
  });

  it('moves a lesson down from its actions menu (the non-drag fallback)', async () => {
    api.POST.mockResolvedValue({ data: structure().modules[0] });
    renderPanel();
    const ue = userEvent.setup();
    await ue.click(
      await screen.findByRole('button', {
        name: tr('fr', 'structure.lessonActions').replace('{title}', 'Leçon l1'),
      }),
    );
    await ue.click(await screen.findByRole('menuitem', { name: tr('fr', 'structure.moveDown') }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/modules/{mid}/lessons/reorder', {
        params: { path: { wid: 'w1', mid: 'm1' }, header: { 'If-Match': '"5"' } },
        body: { ids: ['l2', 'l1'] },
      }),
    );
  });

  it('adds a module through its dialog', async () => {
    api.POST.mockResolvedValue({ data: structure().modules[1] });
    renderPanel();
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: tr('fr', 'structure.addModule') }));
    const dialog = await screen.findByRole('dialog', {
      name: tr('fr', 'structure.moduleCreateTitle'),
    });
    await ue.type(
      within(dialog).getByRole('textbox', { name: tr('fr', 'structure.fieldTitle') }),
      'Les décimaux',
    );
    await ue.selectOptions(
      within(dialog).getByRole('combobox', { name: tr('fr', 'structure.fieldUnlock') }),
      'PREVIOUS_MODULE_COMPLETED',
    );
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'structure.create') }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/courses/{cid}/modules', {
        params: { path: { wid: 'w1', cid: 'c1' }, header: { 'If-Match': '"5"' } },
        body: {
          title: 'Les décimaux',
          isOptional: false,
          unlockRule: { type: 'PREVIOUS_MODULE_COMPLETED' },
        },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('adds a text lesson through the lesson dialog', async () => {
    api.POST.mockResolvedValue({ data: { ...lesson('l9', 'm2'), content: null, images: {} } });
    renderPanel();
    const ue = userEvent.setup();
    const addButtons = await screen.findAllByRole('button', {
      name: tr('fr', 'structure.addLesson'),
    });
    await ue.click(addButtons[1]!);
    const dialog = await screen.findByRole('dialog', {
      name: tr('fr', 'structure.lessonCreateTitle'),
    });
    await ue.click(within(dialog).getByRole('radio', { name: tr('fr', 'structure.type_TEXT') }));
    await ue.type(
      within(dialog).getByRole('textbox', { name: tr('fr', 'structure.fieldTitle') }),
      'Lire une fraction',
    );
    await ue.type(
      within(dialog).getByRole('textbox', { name: tr('fr', 'structure.fieldContent') }),
      'Le numérateur est en haut.',
    );
    await ue.click(within(dialog).getByRole('button', { name: tr('fr', 'structure.create') }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/workspaces/{wid}/modules/{mid}/lessons', {
        params: { path: { wid: 'w1', mid: 'm2' }, header: { 'If-Match': '"5"' } },
        body: {
          type: 'TEXT',
          title: 'Lire une fraction',
          isRequired: true,
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Le numérateur est en haut.' }],
              },
            ],
          },
        },
      }),
    );
  });

  it('polls a processing media every 5 s and stops once it is READY', async () => {
    vi.useFakeTimers();
    mediaAnswers = ['PROCESSING', 'READY'];
    renderPanel();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(tr('fr', 'upload.status_PROCESSING'))).toBeInTheDocument();
    const mediaCalls = () =>
      api.GET.mock.calls.filter((c) => c[0] === '/workspaces/{wid}/media/{mediaId}').length;
    expect(mediaCalls()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mediaCalls()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mediaCalls()).toBe(2);
    expect(screen.getByText(tr('fr', 'upload.status_READY'))).toBeInTheDocument();
    expect(screen.getByText('2:05')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(mediaCalls()).toBe(2);
  });
});
