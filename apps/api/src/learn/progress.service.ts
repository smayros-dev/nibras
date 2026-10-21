import { HttpStatus, Injectable } from '@nestjs/common';
import type { ProgressActionResult } from '@nibras/contracts';
import { Prisma, withTenantTx, type LessonProgress, type TenantTx } from '@nibras/db';
import { ApiError } from '../common/api-error';
import { loadOutline, resolveLessonAccess, type Outline } from './access';
import { lockedError, locate } from './learn.service';
import { LockService } from './lock.service';

type ProgressAction = 'opened' | 'complete' | 'uncomplete';

/**
 * Minimal progress (D-P8, the SP3 subset; spec §4.6): `opened` (IN_PROGRESS, `openedAt`),
 * manual `complete` (COMPLETED, `completedManually`; a PDF never opened → `409
 * LESSON_NOT_OPENED`) and `uncomplete` (back to IN_PROGRESS). Each runs after
 * `resolveLessonAccess` and the lock check (a locked lesson → `403` even for `opened`), inside
 * one `withTenantTx(wid)` serialised on the enrollment row, and recomputes the enrollment's
 * `progressPercent`, `completedAt` (set once at 100, kept afterwards) and `lastActivityAt`.
 * A lesson whose media is not READY → `409 MEDIA_NOT_READY`. An ARCHIVED course is read-only
 * for its students (PRD §8.4.1, « progression figée »): `opened` answers the current state
 * without writing, `complete` / `uncomplete` → `409 COURSE_STATUS_INVALID`. A SUSPENDED or
 * DELETING workspace → `423 WORKSPACE_SUSPENDED` (AC-WS-06, read-only).
 */
@Injectable()
export class ProgressService {
  constructor(private readonly locks: LockService) {}

  opened(userId: string, lid: string): Promise<ProgressActionResult> {
    return this.act(userId, lid, 'opened');
  }

  complete(userId: string, lid: string): Promise<ProgressActionResult> {
    return this.act(userId, lid, 'complete');
  }

  uncomplete(userId: string, lid: string): Promise<ProgressActionResult> {
    return this.act(userId, lid, 'uncomplete');
  }

  /**
   * `Enrollment.progressPercent` from the student's progress rows (completed required lessons of
   * non-optional modules), `completedAt` set at 100 % and kept, `lastActivityAt = now`.
   */
  async recompute(
    tx: TenantTx,
    wid: string,
    courseId: string,
    studentUserId: string,
    outline?: Outline,
  ): Promise<{ progressPercent: number; completedAt: Date | null }> {
    const enrollment = await tx.enrollment.findFirstOrThrow({
      where: { workspaceId: wid, courseId, studentUserId },
    });
    const course = await tx.course.findFirstOrThrow({
      where: { id: courseId },
      select: { id: true, sequentialLessons: true },
    });
    const current = outline ?? (await loadOutline(tx, course, studentUserId));
    const progressPercent = this.locks.coursePercent(current.lockInput);
    const now = new Date();
    const completedAt = enrollment.completedAt ?? (progressPercent === 100 ? now : null);
    await tx.enrollment.update({
      where: { id: enrollment.id },
      data: { progressPercent, completedAt, lastActivityAt: now },
    });
    return { progressPercent, completedAt };
  }

  private async act(
    userId: string,
    lid: string,
    action: ProgressAction,
  ): Promise<ProgressActionResult> {
    const access = await resolveLessonAccess(userId, lid);
    if (access.workspace.status !== 'ACTIVE') {
      throw new ApiError(423, 'WORKSPACE_SUSPENDED', 'Workspace is suspended (read-only)', {
        status: access.workspace.status,
      });
    }
    return withTenantTx(access.wid, async (tx) => {
      // Concurrent actions of one student on one course serialise here (the recompute reads all
      // his rows of the course).
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "enrollment" WHERE id = ${access.enrollment.id}::uuid FOR UPDATE`,
      );
      const outline = await loadOutline(tx, access.course, userId);
      const located = locate(outline, this.locks.evaluate(outline.lockInput), lid);
      if (located.state.locked) throw lockedError(located.state, located.moduleState);
      const { lesson } = located;
      const current = outline.progressByLesson.get(lid);

      if (access.course.status !== 'PUBLISHED') {
        if (action !== 'opened') {
          throw new ApiError(
            HttpStatus.CONFLICT,
            'COURSE_STATUS_INVALID',
            'This course is archived: its progress is frozen',
            { status: access.course.status },
          );
        }
        return result(lid, current, access.enrollment);
      }
      if (action !== 'uncomplete' && lesson.mediaAsset && lesson.mediaAsset.status !== 'READY') {
        throw new ApiError(HttpStatus.CONFLICT, 'MEDIA_NOT_READY', 'The media is not ready', {
          status: lesson.mediaAsset.status,
        });
      }
      if (action === 'complete' && lesson.type === 'PDF' && !current?.openedAt) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'LESSON_NOT_OPENED',
          'Open the document before marking it as completed',
        );
      }

      const now = new Date();
      let row: LessonProgress | undefined = current;
      if (action === 'opened') {
        row = current
          ? await tx.lessonProgress.update({
              where: { id: current.id },
              data: {
                openedAt: current.openedAt ?? now,
                ...(current.status === 'NOT_STARTED' && { status: 'IN_PROGRESS' }),
              },
            })
          : await tx.lessonProgress.create({
              data: {
                workspaceId: access.wid,
                lessonId: lid,
                studentUserId: userId,
                status: 'IN_PROGRESS',
                openedAt: now,
              },
            });
      } else if (action === 'complete') {
        const data = {
          status: 'COMPLETED' as const,
          completedManually: true,
          completedAt: current?.status === 'COMPLETED' ? (current.completedAt ?? now) : now,
          openedAt: current?.openedAt ?? now,
        };
        row = current
          ? await tx.lessonProgress.update({ where: { id: current.id }, data })
          : await tx.lessonProgress.create({
              data: { ...data, workspaceId: access.wid, lessonId: lid, studentUserId: userId },
            });
      } else if (current?.status === 'COMPLETED') {
        row = await tx.lessonProgress.update({
          where: { id: current.id },
          data: { status: 'IN_PROGRESS', completedAt: null, completedManually: false },
        });
      }
      const fresh = row === current ? outline : await loadOutline(tx, access.course, userId);
      const course = await this.recompute(tx, access.wid, access.course.id, userId, fresh);
      return result(lid, row, course);
    });
  }
}

function result(
  lid: string,
  row: LessonProgress | undefined,
  course: { progressPercent: number; completedAt: Date | null },
): ProgressActionResult {
  return {
    lesson: {
      id: lid,
      status: row?.status ?? 'NOT_STARTED',
      completedAt: row?.completedAt?.toISOString() ?? null,
    },
    course: {
      progressPercent: course.progressPercent,
      completedAt: course.completedAt?.toISOString() ?? null,
    },
  };
}
