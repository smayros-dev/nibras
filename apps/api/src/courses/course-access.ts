import { HttpStatus } from '@nestjs/common';
import { Prisma, type CourseStatus, type MembershipRole, type TenantTx } from '@nibras/db';
import { ApiError } from '../common/api-error';
import { RequestContext } from '../common/request-context';
import { permissionDenied } from '../tenancy/permissions';

/**
 * Who reads or changes courses: the route's workspace, the caller, his membership role and the
 * scope the permission guard granted (`own` = TEACHER / personal OWNER: `Course.ownerUserId = me`;
 * `all` = organisation OWNER/ADMIN).
 */
export interface CourseCtx {
  workspaceId: string;
  userId: string;
  role: MembershipRole;
  scope: 'all' | 'own';
}

/** Members who learn, not teach: their courses are under `/me/courses` (spec §7). */
const LEARNER_ROLES: readonly MembershipRole[] = ['STUDENT', 'GUARDIAN'];

/**
 * The caller's `CourseCtx` on a `/workspaces/:wid/courses…` route behind `@RequirePermission`.
 * A STUDENT/GUARDIAN membership → `403 PERMISSION_DENIED` whatever the matrix grants (its
 * `course.read` only serves the `/me` routes). Fails closed: no granted scope reads as `own`.
 */
export function courseCtx(workspaceId: string): CourseCtx {
  const store = RequestContext.get();
  const userId = store?.user?.id;
  const role = store?.membership?.role;
  if (!userId || !role || store.workspace?.id !== workspaceId) {
    throw new Error('courseCtx() outside a /workspaces/:wid route');
  }
  if (LEARNER_ROLES.includes(role)) throw permissionDenied();
  return { workspaceId, userId, role, scope: store.permissionScope === 'all' ? 'all' : 'own' };
}

/** Scope `own` → the caller's courses only; `all` → no restriction. */
export function ownerFilter(ctx: CourseCtx): Prisma.CourseWhereInput {
  return ctx.scope === 'own' ? { ownerUserId: ctx.userId } : {};
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID.test(value);

export function courseNotFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}

/** The columns a write needs from the locked course row. */
export interface LockedCourse {
  id: string;
  ownerUserId: string;
  status: CourseStatus;
  version: number;
}

/**
 * `SELECT … FOR UPDATE` on a live course of the transaction's workspace in the caller's scope:
 * concurrent writes on one course (and its modules and lessons, T6) serialise on this row, so the
 * version check and the bump cannot interleave (Review Focus 1). Not a uuid, another workspace's,
 * deleted, or outside the scope → `404 NOT_FOUND`.
 */
export async function loadCourseForWrite(
  tx: TenantTx,
  ctx: CourseCtx,
  cid: string,
): Promise<LockedCourse> {
  if (!isUuid(cid)) throw courseNotFound();
  const own =
    ctx.scope === 'own' ? Prisma.sql`AND owner_user_id = ${ctx.userId}::uuid` : Prisma.empty;
  const rows = await tx.$queryRaw<
    { id: string; owner_user_id: string; status: CourseStatus; version: number }[]
  >(Prisma.sql`SELECT id, owner_user_id, status, version FROM "course"
    WHERE id = ${cid}::uuid AND workspace_id = ${ctx.workspaceId}::uuid AND deleted_at IS NULL ${own}
    FOR UPDATE`);
  const row = rows[0];
  if (!row) throw courseNotFound();
  return { id: row.id, ownerUserId: row.owner_user_id, status: row.status, version: row.version };
}

/** `UPDATE course SET version = version + 1` inside the caller's transaction; the new version. */
export async function bumpCourseVersion(tx: TenantTx, courseId: string): Promise<number> {
  const { version } = await tx.course.update({
    where: { id: courseId },
    data: { version: { increment: 1 } },
    select: { version: true },
  });
  return version;
}
