'use client';

import type { CourseDetail } from '@nibras/contracts';
import { grantFor, type GrantContext } from '@nibras/contracts/web';
import { AlertDialog, Button, DropdownMenu, PageHeader, useSubmit, useToast } from '@nibras/ui';
import {
  Archive,
  ArchiveRestore,
  EyeOff,
  MoreHorizontal,
  Send,
  Trash2,
  UserRoundCog,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { useRouter } from '../../i18n/navigation';
import { api, asApiResult } from '../../lib/api';
import { apiErrorMessage } from '../../lib/api-error';
import { useReturnFocus } from '../../lib/use-return-focus';
import { CourseStatusBadge } from './course-status-badge';

/** Fetched on the first « Réaffecter » (PRD §14.1 budget). */
const ReassignCourseDialog = lazy(() =>
  import('./reassign-course-dialog').then((m) => ({ default: m.ReassignCourseDialog })),
);

type Transition = 'publish' | 'unpublish' | 'archive' | 'restore';
type Confirm = 'unpublish' | 'delete' | 'archiveDelete';

const TRANSITION_PATHS = {
  publish: '/workspaces/{wid}/courses/{cid}/publish',
  unpublish: '/workspaces/{wid}/courses/{cid}/unpublish',
  archive: '/workspaces/{wid}/courses/{cid}/archive',
  restore: '/workspaces/{wid}/courses/{cid}/restore',
} as const;

const DONE_KEYS: Record<Transition, string> = {
  publish: 'courses.published',
  unpublish: 'courses.unpublished',
  archive: 'courses.archived',
  restore: 'courses.restored',
};

/**
 * The course page header (PRD §8.4.1): title, status badge and the actions the §7 matrix and the
 * status machine allow — **Publier** (a DRAFT; disabled with the missing items listed while
 * `publishBlockers` is not empty), then a menu with **Dépublier** (confirmed: students lose
 * access, enrollments and progress are kept) and **Archiver** (PUBLISHED), **Restaurer**
 * (ARCHIVED), **Réaffecter** (organisation ADMIN/OWNER, `course.reassign`), **Supprimer** (DRAFT or
 * ARCHIVED; soft, 30 days) and, for a PUBLISHED course, « Archiver puis supprimer »: one
 * confirmation, then archive and delete in turn (a refused delete leaves the course archived and
 * says why). Scope `own` (an organisation TEACHER) acts on his own courses only; a SUSPENDED
 * workspace has no write action. Every answer goes to `onChanged` (the new version for the next
 * write); a deletion goes back to the list.
 */
export function CourseHeader({
  wid,
  meId,
  course,
  grant,
  writable,
  onChanged,
}: {
  wid: string;
  meId: string;
  course: CourseDetail;
  grant: GrantContext;
  writable: boolean;
  onChanged: (course: CourseDetail) => void;
}) {
  const t = useTranslations();
  const { toast } = useToast();
  const router = useRouter();
  const returnFocus = useReturnFocus();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  /** `null` until first opened: the dialog's chunk is fetched then. */
  const [reassignOpen, setReassignOpen] = useState<boolean | null>(null);

  const allowed = (permission: 'course.manage' | 'course.delete') => {
    const g = grantFor(grant, permission);
    return writable && (g === 'all' || (g === 'own' && course.ownerUserId === meId));
  };
  const canManage = allowed('course.manage');
  const canDelete = allowed('course.delete');
  const canReassign =
    writable &&
    grant.workspaceType === 'ORGANIZATION' &&
    grantFor(grant, 'course.reassign') === 'all';
  const path = { wid, cid: course.id };
  const { status } = course;

  const fail = (error: unknown) =>
    toast({ title: apiErrorMessage(t, error ?? null), variant: 'danger' });

  /** One transition; the updated course, or `null` after a toast. */
  const move = async (name: Transition): Promise<CourseDetail | null> => {
    try {
      const { data, error } = asApiResult<CourseDetail>(
        await api.POST(TRANSITION_PATHS[name], { params: { path } }),
      );
      if (error || !data) {
        fail(error);
        return null;
      }
      onChanged(data);
      return data;
    } catch {
      fail(null);
      return null;
    }
  };

  const remove = async (): Promise<boolean> => {
    try {
      const { error } = asApiResult<unknown>(
        await api.DELETE('/workspaces/{wid}/courses/{cid}', { params: { path } }),
      );
      if (error) {
        fail(error);
        return false;
      }
    } catch {
      fail(null);
      return false;
    }
    toast({ title: t('courses.deleted'), variant: 'success' });
    router.push(`/app/w/${wid}/courses`);
    return true;
  };

  const action = useSubmit(async (name: Transition) => {
    if (await move(name)) toast({ title: t(DONE_KEYS[name]), variant: 'success' });
  });

  const confirmed = useSubmit(async (kind: Confirm) => {
    if (kind === 'unpublish') {
      if (await move('unpublish')) toast({ title: t('courses.unpublished'), variant: 'success' });
    } else if (kind === 'delete') {
      await remove();
    } else if (await move('archive')) {
      await remove();
    }
    setConfirm(null);
  });

  const items: { key: string; node: ReactNode }[] = [];
  const item = (
    key: string,
    label: string,
    icon: ReactNode,
    onSelect: () => void,
    destructive = false,
  ) =>
    items.push({
      key,
      node: (
        <DropdownMenu.Item
          key={key}
          icon={icon}
          destructive={destructive}
          disabled={action.busy}
          onSelect={onSelect}
        >
          {label}
        </DropdownMenu.Item>
      ),
    });
  const ask = (kind: Confirm) => () => {
    returnFocus.remember('menu');
    setConfirm(kind);
  };
  if (canManage && status === 'PUBLISHED') {
    item('unpublish', t('courses.unpublish'), <EyeOff />, ask('unpublish'));
    item('archive', t('courses.archive'), <Archive />, () => void action.submit('archive'));
  }
  if (canManage && status === 'ARCHIVED') {
    item('restore', t('courses.restore'), <ArchiveRestore />, () => void action.submit('restore'));
  }
  if (canReassign) {
    item('reassign', t('courses.reassign'), <UserRoundCog />, () => {
      returnFocus.remember('menu');
      setReassignOpen(true);
    });
  }
  if (canDelete && status !== 'PUBLISHED') {
    item('delete', t('courses.delete'), <Trash2 />, ask('delete'), true);
  }
  if (canManage && canDelete && status === 'PUBLISHED') {
    item('archiveDelete', t('courses.archiveDelete'), <Trash2 />, ask('archiveDelete'), true);
  }

  const showPublish = canManage && status === 'DRAFT';
  const blocked = course.publishBlockers.length > 0;

  const confirmCopy: Record<Confirm, { title: string; description: string; action: string }> = {
    unpublish: {
      title: t('courses.unpublishTitle', { title: course.title }),
      description: t('courses.unpublishDescription'),
      action: t('courses.unpublish'),
    },
    delete: {
      title: t('courses.deleteTitle', { title: course.title }),
      description: t('courses.deleteDescription'),
      action: t('courses.delete'),
    },
    archiveDelete: {
      title: t('courses.archiveDeleteTitle', { title: course.title }),
      description: t('courses.archiveDeleteDescription'),
      action: t('courses.archiveDelete'),
    },
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        as="h2"
        title={course.title}
        description={<CourseStatusBadge status={status} />}
        actions={
          showPublish || items.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {showPublish ? (
                <Button
                  variant="primary"
                  disabled={!course.canPublish || blocked}
                  loading={action.busy}
                  aria-describedby={blocked ? 'course-publish-blockers' : undefined}
                  onClick={() => void action.submit('publish')}
                >
                  <Send aria-hidden="true" className="size-4 rtl:-scale-x-100" />
                  {t('courses.publish')}
                </Button>
              ) : null}
              {items.length > 0 ? (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      variant="secondary"
                      size="icon"
                      aria-label={t('courses.actions')}
                      ref={returnFocus.register('menu')}
                    >
                      <MoreHorizontal aria-hidden="true" className="size-5" />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end">
                    {items.map((i) => i.node)}
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              ) : null}
            </div>
          ) : null
        }
      />
      {showPublish && blocked ? (
        <div id="course-publish-blockers" className="text-sm text-fg-muted">
          <p>{t('courses.publishBlocked')}</p>
          <ul className="list-disc ps-5">
            {course.publishBlockers.map((b) => (
              <li key={b}>{t(`courses.blocker_${b}`)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <AlertDialog.Root
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        {confirm ? (
          <AlertDialog.Content
            title={confirmCopy[confirm].title}
            description={confirmCopy[confirm].description}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          >
            <AlertDialog.Footer>
              <AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>
              <AlertDialog.Action
                destructive={confirm !== 'unpublish'}
                loading={confirmed.busy}
                onClick={(event) => {
                  // Stay open while the requests run; close on the outcome.
                  event.preventDefault();
                  void confirmed.submit(confirm);
                }}
              >
                {confirmCopy[confirm].action}
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        ) : null}
      </AlertDialog.Root>

      {canReassign && reassignOpen !== null ? (
        <Suspense fallback={null}>
          <ReassignCourseDialog
            wid={wid}
            course={course}
            open={reassignOpen}
            onOpenChange={setReassignOpen}
            onReassigned={onChanged}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
