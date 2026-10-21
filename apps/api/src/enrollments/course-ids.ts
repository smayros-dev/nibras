import { HttpStatus } from '@nestjs/common';
import { tenantDb } from '@nibras/db';
import { ApiError } from '../common/api-error';

/**
 * The `courseIds` of a new invitation or invite link (SP2 stored them unvalidated; SP3 T9): each
 * must name a live (not deleted) DRAFT or PUBLISHED course of `workspaceId` — an ARCHIVED course
 * takes no new assignment — and, for a caller in scope `own` (`ownerUserId`), one of his own
 * courses. Anything else (another workspace's id, unknown, deleted, archived, someone else's) →
 * `422 VALIDATION_FAILED` with `issues[].path = ['courseIds', i]`. A DRAFT course is accepted:
 * its students are notified at publication. The acceptance-time hooks still re-check (a course
 * may be deleted or archived in between) and skip what no longer qualifies.
 */
export async function assertAssignableCourseIds(
  workspaceId: string,
  courseIds: readonly string[],
  ownerUserId?: string,
): Promise<void> {
  if (courseIds.length === 0) return;
  const found = new Set(
    (
      await tenantDb(workspaceId).course.findMany({
        where: {
          id: { in: [...courseIds] },
          deletedAt: null,
          status: { in: ['DRAFT', 'PUBLISHED'] },
          ...(ownerUserId !== undefined && { ownerUserId }),
        },
        select: { id: true },
      })
    ).map((c) => c.id),
  );
  const issues = courseIds.flatMap((id, i) =>
    found.has(id)
      ? []
      : [{ path: ['courseIds', i], message: 'Not an assignable course of this workspace' }],
  );
  if (issues.length > 0) {
    throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', 'Validation failed', {
      issues,
    });
  }
}
