'use client';

import type { CourseStructure, LessonSummary, ModuleWithLessons } from '@nibras/contracts';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Card,
  DropdownMenu,
  EmptyState,
  SkeletonText,
  useSubmit,
  useToast,
} from '@nibras/ui';
import {
  ArrowDown,
  ArrowUp,
  FileText,
  ListTree,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, asApiResult } from '../../lib/api';
import { apiErrorMessage } from '../../lib/api-error';
import {
  conflictVersion,
  withIfMatch,
  type CourseWrite,
  type WriteOutcome,
} from '../../lib/courses';
import { useReturnFocus } from '../../lib/use-return-focus';
import { LessonDialog } from './lesson-dialog';
import { MediaStateChip } from './media-state-chip';
import { ModuleDialog } from './module-dialog';
import { SortableList } from './sortable-list';

const VersionConflictDialog = lazy(() =>
  import('./version-conflict-dialog').then((m) => ({ default: m.VersionConflictDialog })),
);
const UploadDialog = lazy(() =>
  import('./upload-dialog').then((m) => ({ default: m.UploadDialog })),
);

const TYPE_ICON: Record<LessonSummary['type'], LucideIcon> = {
  VIDEO: Video,
  PDF: FileText,
  TEXT: FileText,
};

type Editing =
  | { kind: 'module'; module: ModuleWithLessons | null }
  | { kind: 'lesson'; moduleId: string; lesson: LessonSummary | null };

type Deleting = { kind: 'module' | 'lesson'; id: string; title: string };

interface Conflict {
  version: number;
  write: CourseWrite;
  success?: string;
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * The course's Structure tab (PRD §8.4.2–8.4.4, AC-CRS-04): modules and their lessons, reordered
 * by drag and drop or with the keyboard (`SortableList`), or from each row's menu (« Monter /
 * Descendre »); create / edit dialogs, delete with confirmation, each lesson's media state
 * (polled while processing, « Réessayer » after a failure uploads a replacement).
 *
 * Every write carries `If-Match` with the course version of the latest structure; after it the
 * structure is fetched again (its version follows the bump) and `onCourseChanged` refreshes the
 * course (header counts, publish blockers, the settings form's version). A `409` opens
 * `VersionConflictDialog` (« Recharger » / « Écraser »). Loaded on demand by the course page.
 */
export function StructurePanel({
  wid,
  courseId,
  writable,
  onCourseChanged,
}: {
  wid: string;
  courseId: string;
  writable: boolean;
  onCourseChanged?: () => void;
}) {
  const t = useTranslations();
  const { toast } = useToast();
  const [structure, setStructure] = useState<CourseStructure | null>(null);
  const [loadError, setLoadError] = useState(false);
  const version = useRef(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [conflictMounted, setConflictMounted] = useState(false);
  const [replacing, setReplacing] = useState<LessonSummary | null>(null);
  const returnFocus = useReturnFocus();
  const changed = useRef(onCourseChanged);
  useEffect(() => {
    changed.current = onCourseChanged;
  });

  const load = useCallback(async () => {
    try {
      const { data } = asApiResult<CourseStructure>(
        await api.GET('/workspaces/{wid}/courses/{cid}/structure', {
          params: { path: { wid, cid: courseId } },
        }),
      );
      if (data) {
        version.current = data.version;
        setStructure(data);
        setLoadError(false);
        return;
      }
    } catch {
      // Shown below.
    }
    setLoadError(true);
  }, [wid, courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    await load();
    changed.current?.();
  }, [load]);

  const run = useCallback(
    async (write: CourseWrite, success?: string): Promise<WriteOutcome> => {
      let result: { data?: unknown; error?: unknown };
      try {
        result = await write(version.current);
      } catch {
        return { ok: false, conflict: false, error: null };
      }
      if (!result.error) {
        await refresh();
        if (success) toast({ title: success, variant: 'success' });
        return { ok: true };
      }
      const current = conflictVersion(result.error);
      if (current !== null) {
        setConflictMounted(true);
        setConflict({ version: current, write, success });
        return { ok: false, conflict: true, error: result.error };
      }
      return { ok: false, conflict: false, error: result.error };
    },
    [refresh, toast],
  );

  /** A write without a form (reorder, delete): its error becomes a toast and the view reloads. */
  const act = async (write: CourseWrite, success?: string) => {
    const outcome = await run(write, success);
    if (!outcome.ok && !outcome.conflict) {
      toast({ title: apiErrorMessage(t, outcome.error ?? null), variant: 'danger' });
      await load();
    } else if (!outcome.ok) {
      await load();
    }
  };

  const formRun = useCallback((write: CourseWrite) => run(write, t('structure.saved')), [run, t]);

  const reorderModules = (ids: string[]) => {
    setStructure((s) =>
      s ? { ...s, modules: ids.map((id) => s.modules.find((m) => m.id === id)!) } : s,
    );
    void act(
      (v) =>
        api.POST('/workspaces/{wid}/courses/{cid}/modules/reorder', {
          params: { path: { wid, cid: courseId }, header: withIfMatch(v) },
          body: { ids },
        }),
      t('structure.reordered'),
    );
  };

  const reorderLessons = (mid: string, ids: string[]) => {
    setStructure((s) =>
      s
        ? {
            ...s,
            modules: s.modules.map((m) =>
              m.id === mid
                ? { ...m, lessons: ids.map((id) => m.lessons.find((l) => l.id === id)!) }
                : m,
            ),
          }
        : s,
    );
    void act(
      (v) =>
        api.POST('/workspaces/{wid}/modules/{mid}/lessons/reorder', {
          params: { path: { wid, mid }, header: withIfMatch(v) },
          body: { ids },
        }),
      t('structure.reordered'),
    );
  };

  const remove = useSubmit(async (target: Deleting) => {
    await act(
      (v) =>
        target.kind === 'module'
          ? api.DELETE('/workspaces/{wid}/modules/{mid}', {
              params: { path: { wid, mid: target.id }, header: withIfMatch(v) },
            })
          : api.DELETE('/workspaces/{wid}/lessons/{lid}', {
              params: { path: { wid, lid: target.id }, header: withIfMatch(v) },
            }),
      t('structure.deleted'),
    );
    setDeleting(null);
  });

  const open = (key: string, next: Editing) => {
    returnFocus.remember(key);
    setEditing(next);
  };

  const menu = (
    key: string,
    label: string,
    index: number,
    count: number,
    onEdit: () => void,
    onMove: (to: number) => void,
    onDelete: () => void,
  ) => (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} ref={returnFocus.register(key)}>
          <MoreHorizontal aria-hidden="true" className="size-5" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Item icon={<Pencil />} onSelect={onEdit}>
          {t('structure.edit')}
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={<ArrowUp />}
          disabled={index === 0}
          onSelect={() => onMove(index - 1)}
        >
          {t('structure.moveUp')}
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={<ArrowDown />}
          disabled={index === count - 1}
          onSelect={() => onMove(index + 1)}
        >
          {t('structure.moveDown')}
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={<Trash2 />}
          destructive
          onSelect={() => {
            returnFocus.remember(key);
            onDelete();
          }}
        >
          {t('structure.delete')}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );

  const lessonRow = (
    module: ModuleWithLessons,
    lesson: LessonSummary,
    handle: ReactNode,
    index: number,
  ) => {
    const Icon = TYPE_ICON[lesson.type];
    const key = `lesson:${lesson.id}`;
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-2 py-1">
        {handle}
        <Icon aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
        <span className="sr-only">{t(`structure.type_${lesson.type}`)}</span>
        <span className="min-w-0 flex-1 break-words text-fg">{lesson.title}</span>
        {lesson.media ? (
          <MediaStateChip
            wid={wid}
            media={lesson.media}
            onSettled={() => changed.current?.()}
            onRetry={
              writable && lesson.type !== 'TEXT'
                ? () => {
                    returnFocus.remember(key);
                    setReplacing(lesson);
                  }
                : undefined
            }
          />
        ) : null}
        {writable
          ? menu(
              key,
              t('structure.lessonActions', { title: lesson.title }),
              index,
              module.lessons.length,
              () => open(key, { kind: 'lesson', moduleId: module.id, lesson }),
              (to) =>
                reorderLessons(
                  module.id,
                  move(
                    module.lessons.map((l) => l.id),
                    index,
                    to,
                  ),
                ),
              () => setDeleting({ kind: 'lesson', id: lesson.id, title: lesson.title }),
            )
          : null}
      </div>
    );
  };

  const moduleCard = (
    module: ModuleWithLessons,
    handle: ReactNode,
    index: number,
    count: number,
  ) => {
    const key = `module:${module.id}`;
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg-subtle p-3">
        <div className="flex flex-wrap items-center gap-2">
          {handle}
          <h4 className="min-w-0 flex-1 break-words font-semibold text-fg">{module.title}</h4>
          {module.isOptional ? <Badge variant="neutral">{t('structure.optional')}</Badge> : null}
          {module.unlockRule.type === 'PREVIOUS_MODULE_COMPLETED' ? (
            <Badge variant="info">{t('structure.unlockAfterPrevious')}</Badge>
          ) : null}
          {writable
            ? menu(
                key,
                t('structure.moduleActions', { title: module.title }),
                index,
                count,
                () => open(key, { kind: 'module', module }),
                (to) =>
                  reorderModules(
                    move(
                      (structure?.modules ?? []).map((m) => m.id),
                      index,
                      to,
                    ),
                  ),
                () => setDeleting({ kind: 'module', id: module.id, title: module.title }),
              )
            : null}
        </div>
        {module.lessons.length > 0 ? (
          <SortableList
            items={module.lessons}
            label={t('structure.lessonsList', { title: module.title })}
            titleOf={(l) => l.title}
            disabled={!writable}
            onReorder={(ids) => reorderLessons(module.id, ids)}
            className="gap-2"
            renderItem={(lesson, ctx) => lessonRow(module, lesson, ctx.handle, ctx.index)}
          />
        ) : (
          <p className="text-sm text-fg-muted">{t('structure.noLessons')}</p>
        )}
        {writable ? (
          <div>
            <Button
              variant="secondary"
              size="sm"
              ref={returnFocus.register(`add:${module.id}`)}
              onClick={() =>
                open(`add:${module.id}`, { kind: 'lesson', moduleId: module.id, lesson: null })
              }
            >
              <Plus aria-hidden="true" className="size-4" />
              {t('structure.addLesson')}
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  const addModule = writable ? (
    <Button
      variant="primary"
      ref={returnFocus.register('addModule')}
      onClick={() => open('addModule', { kind: 'module', module: null })}
    >
      <Plus aria-hidden="true" className="size-4" />
      {t('structure.addModule')}
    </Button>
  ) : null;

  let body: ReactNode;
  if (structure === null && loadError) {
    body = (
      <Alert variant="danger">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('structure.loadFailed')}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </div>
      </Alert>
    );
  } else if (structure === null) {
    body = <SkeletonText lines={4} />;
  } else if (structure.modules.length === 0) {
    body = (
      <EmptyState
        as="h3"
        icon={<ListTree />}
        title={t('structure.emptyTitle')}
        description={t('structure.emptyDescription')}
        action={addModule}
      />
    );
  } else {
    const count = structure.modules.length;
    body = (
      <SortableList
        items={structure.modules}
        label={t('structure.modulesList')}
        titleOf={(m) => m.title}
        disabled={!writable}
        onReorder={reorderModules}
        renderItem={(module, ctx) => moduleCard(module, ctx.handle, ctx.index, count)}
      />
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-fg">{t('structure.title')}</h3>
          {structure && structure.modules.length > 0 ? addModule : null}
        </div>
        {body}
      </div>

      {editing?.kind === 'module' ? (
        <ModuleDialog
          wid={wid}
          courseId={courseId}
          module={editing.module}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          run={formRun}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        />
      ) : null}
      {editing?.kind === 'lesson' ? (
        <LessonDialog
          wid={wid}
          moduleId={editing.moduleId}
          lesson={editing.lesson}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          run={formRun}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        />
      ) : null}

      <AlertDialog.Root
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
      >
        {deleting ? (
          <AlertDialog.Content
            title={t(
              deleting.kind === 'module'
                ? 'structure.deleteModuleTitle'
                : 'structure.deleteLessonTitle',
              { title: deleting.title },
            )}
            description={t(
              deleting.kind === 'module'
                ? 'structure.deleteModuleDescription'
                : 'structure.deleteLessonDescription',
            )}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          >
            <AlertDialog.Footer>
              <AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>
              <AlertDialog.Action
                destructive
                loading={remove.busy}
                onClick={(event) => {
                  event.preventDefault();
                  void remove.submit(deleting);
                }}
              >
                {t('structure.delete')}
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        ) : null}
      </AlertDialog.Root>

      {replacing && replacing.type !== 'TEXT' ? (
        <Suspense fallback={null}>
          <UploadDialog
            wid={wid}
            kind={replacing.type}
            open
            onOpenChange={(o) => {
              if (!o) setReplacing(null);
            }}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
            onUploaded={(asset) => {
              const lesson = replacing;
              setReplacing(null);
              void act(
                (v) =>
                  api.PATCH('/workspaces/{wid}/lessons/{lid}', {
                    params: { path: { wid, lid: lesson.id }, header: withIfMatch(v) },
                    body: { mediaAssetId: asset.id },
                  }),
                t('structure.saved'),
              );
            }}
          />
        </Suspense>
      ) : null}

      {conflictMounted ? (
        <Suspense fallback={null}>
          <VersionConflictDialog
            open={conflict !== null}
            currentVersion={conflict?.version ?? version.current}
            onOpenChange={(o) => {
              if (!o) setConflict(null);
            }}
            onReload={() => {
              setConflict(null);
              void refresh();
            }}
            onOverwrite={(v) => {
              const pending = conflict;
              setConflict(null);
              if (pending) void act(() => pending.write(v), pending.success);
            }}
          />
        </Suspense>
      ) : null}
    </Card>
  );
}
