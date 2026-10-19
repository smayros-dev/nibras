import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  MemberSummary,
  MembersPage,
  MembersQuery,
  UpdateMemberInput,
} from '@nibras/contracts';
import {
  tenantDb,
  withTenantTx,
  type Membership,
  type MembershipRole,
  type Prisma,
  type User,
} from '@nibras/db';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { RequestContext } from '../common/request-context';
import { currentGrant, permissionDenied } from '../tenancy/permissions';
import { validationFailed } from '../workspaces/workspaces.service';
import { MEMBERSHIP_REMOVED, MembershipRemovedEvent } from './events';
import { MEMBER_REMOVAL_BLOCKERS, type MemberRemovalBlocker } from './removal-blockers';

/**
 * Who reads or changes members: the route's workspace, the caller and the scope the permission
 * guard granted (`own` = organisation TEACHER/ASSISTANT: his students only, no email).
 */
export interface MemberCtx {
  workspaceId: string;
  userId: string;
  scope: 'all' | 'own';
}

/** The caller's `MemberCtx` on a `/workspaces/:wid/…` route behind `@RequirePermission`. */
export function memberCtx(workspaceId: string): MemberCtx {
  const store = RequestContext.get();
  const userId = store?.user?.id;
  if (!userId || store.workspace?.id !== workspaceId) {
    throw new Error('memberCtx() outside a /workspaces/:wid route');
  }
  // Fails closed: without a granted scope the caller reads as `own`.
  return { workspaceId, userId, scope: store.permissionScope === 'all' ? 'all' : 'own' };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Memberships that are over: listed only when asked for by `status`, never changed. */
const ENDED: Membership['status'][] = ['REMOVED', 'REJECTED'];
/** The only roles a role change moves between. */
const STAFF_ROLES: MembershipRole[] = ['ADMIN', 'TEACHER'];
/** Targets removed under `student.remove`; every other non-OWNER role is staff. */
const STUDENT_SIDE: MembershipRole[] = ['STUDENT', 'GUARDIAN'];

const USER_FIELDS = { firstName: true, lastName: true, email: true } as const;
type MemberRow = Membership & { user: Pick<User, 'firstName' | 'lastName' | 'email'> };

function notFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}

function toSummary(m: MemberRow, scope: MemberCtx['scope']): MemberSummary {
  return {
    userId: m.userId,
    firstName: m.user.firstName,
    lastName: m.user.lastName,
    ...(scope === 'all' && { email: m.user.email }),
    role: m.role,
    canTeach: m.canTeach,
    status: m.status,
    joinedAt: m.joinedAt?.toISOString() ?? null,
  };
}

/** Position of a member in the listing order: last name, first name, user id. */
type Cursor = [lastName: string, firstName: string, userId: string];

function encodeCursor(m: MemberRow): string {
  const c: Cursor = [m.user.lastName, m.user.firstName, m.userId];
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const c: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      Array.isArray(c) &&
      c.length === 3 &&
      c.every((x) => typeof x === 'string') &&
      UUID.test(c[2] as string)
    ) {
      return c as Cursor;
    }
  } catch {
    // Falls through to the validation error.
  }
  throw validationFailed('cursor', 'Unknown cursor');
}

/** Rows strictly after `c` in (lastName, firstName, userId) order. */
function after([lastName, firstName, userId]: Cursor): Prisma.MembershipWhereInput {
  return {
    OR: [
      { user: { lastName: { gt: lastName } } },
      { user: { lastName, firstName: { gt: firstName } } },
      { user: { lastName, firstName }, userId: { gt: userId } },
    ],
  };
}

/**
 * The member directory of a workspace (PRD §8.2, §15 "Membres"). Every membership query goes
 * through `tenantDb(wid)` / `withTenantTx(wid)`, so a user who belongs to another workspace only
 * is not found here (Review Focus 1); user names and emails are read through the membership's
 * `user` relation.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    @Inject(MEMBER_REMOVAL_BLOCKERS) private readonly blockers: MemberRemovalBlocker[],
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(MembersService.name);
  }

  /**
   * `GET /workspaces/{wid}/members`. Scope `all` → every member; scope `own` → only `STUDENT`
   * members assigned to the caller or invited by him (a `role` filter narrows, never widens).
   * Without `status`, `REMOVED`/`REJECTED` memberships are left out. `q` is a case-insensitive
   * substring of the first name, last name or (scope `all` only) email. Keyset pagination on
   * (last name, first name, user id).
   */
  async list(ctx: MemberCtx, q: MembersQuery): Promise<MembersPage> {
    const cursor = q.cursor === undefined ? undefined : await this.cursorIn(ctx, q.cursor);
    const and: Prisma.MembershipWhereInput[] = [
      q.status ? { status: q.status } : { status: { notIn: ENDED } },
    ];
    if (q.role) and.push({ role: q.role });
    if (ctx.scope === 'own') and.push(await this.ownScope(ctx));
    if (q.q) {
      const contains = { contains: q.q, mode: 'insensitive' } as const;
      and.push({
        user: {
          OR: [
            { firstName: contains },
            { lastName: contains },
            ...(ctx.scope === 'all' ? [{ email: contains }] : []),
          ],
        },
      });
    }
    if (cursor) and.push(after(cursor));

    const rows = await tenantDb(ctx.workspaceId).membership.findMany({
      where: { AND: and },
      include: { user: { select: USER_FIELDS } },
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }, { userId: 'asc' }],
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit);
    return {
      items: items.map((m) => toSummary(m, ctx.scope)),
      nextCursor: rows.length > q.limit ? encodeCursor(items[items.length - 1]!) : null,
    };
  }

  /**
   * A list cursor names a membership of this workspace (any status), like the audit-log and
   * abuse-report cursors: a well-formed position taken from another workspace's listing → `422`
   * (SP1.6 F8), never a page of this one positioned by a foreign member.
   */
  private async cursorIn(ctx: MemberCtx, raw: string): Promise<Cursor> {
    const cursor = decodeCursor(raw);
    const row = await tenantDb(ctx.workspaceId).membership.findFirst({
      where: { userId: cursor[2] },
      select: { id: true },
    });
    if (!row) throw validationFailed('cursor', 'Unknown cursor');
    return cursor;
  }

  /** `GET /workspaces/{wid}/members/{uid}`: this workspace's membership of `uid`, any status. */
  async get(ctx: MemberCtx, uid: string): Promise<MemberSummary> {
    if (!UUID.test(uid)) throw notFound();
    const where: Prisma.MembershipWhereInput[] = [{ userId: uid }];
    if (ctx.scope === 'own') where.push(await this.ownScope(ctx));
    const m = await tenantDb(ctx.workspaceId).membership.findFirst({
      where: { AND: where },
      include: { user: { select: USER_FIELDS } },
    });
    if (!m) throw notFound();
    return toSummary(m, ctx.scope);
  }

  /**
   * `PATCH /workspaces/{wid}/members/{uid}` (`workspace.staff.manage`): role only between ADMIN
   * and TEACHER (any other current or requested role → `422 ROLE_CHANGE_NOT_ALLOWED`);
   * `canTeach` belongs to an ADMIN (a TEACHER always has `false`; asking `true` for one → `422
   * VALIDATION_FAILED`). Audits `member.role_changed` with before/after `{ role, canTeach }` when
   * something changed. A promotion to ADMIN of an organisation makes 2FA mandatory for that user
   * from his next request on (D-P12, `AccountGatesGuard`).
   */
  async update(ctx: MemberCtx, uid: string, input: UpdateMemberInput): Promise<MemberSummary> {
    if (!UUID.test(uid)) throw notFound();
    const { before, member } = await withTenantTx(ctx.workspaceId, async (tx) => {
      const current = await tx.membership.findFirst({
        where: { userId: uid, status: { notIn: ENDED } },
        include: { user: { select: USER_FIELDS } },
      });
      if (!current) throw notFound();
      if (
        !STAFF_ROLES.includes(current.role) ||
        (input.role !== undefined && !STAFF_ROLES.includes(input.role))
      ) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'ROLE_CHANGE_NOT_ALLOWED',
          'Only an admin or a teacher can change role, and only between admin and teacher',
        );
      }
      const role = input.role ?? current.role;
      if (role === 'TEACHER' && input.canTeach === true) {
        throw validationFailed('canTeach', 'canTeach only applies to an admin');
      }
      const canTeach = role === 'TEACHER' ? false : (input.canTeach ?? current.canTeach);
      const before = { role: current.role, canTeach: current.canTeach };
      if (role === current.role && canTeach === current.canTeach) {
        return { before, member: current };
      }
      // Conditional on the role and status read above: a membership promoted to OWNER (or
      // removed) concurrently matches nothing → 404 (spec SP1.6 F7).
      const { count } = await tx.membership.updateMany({
        where: { id: current.id, role: current.role, status: current.status },
        data: { role, canTeach },
      });
      if (count !== 1) throw notFound();
      const member = await tx.membership.findUniqueOrThrow({
        where: { id: current.id },
        include: { user: { select: USER_FIELDS } },
      });
      return { before, member };
    });
    if (before.role !== member.role || before.canTeach !== member.canTeach) {
      await this.audit.log({
        action: 'member.role_changed',
        entityType: 'Membership',
        entityId: member.id,
        before,
        after: { role: member.role, canTeach: member.canTeach },
      });
    }
    return toSummary(member, ctx.scope);
  }

  /**
   * `DELETE /workspaces/{wid}/members/{uid}`. A caller with neither `student.remove` nor
   * `workspace.staff.manage` → `403` before any lookup; no live membership → `404`; the OWNER →
   * `409 OWNER_CANNOT_BE_REMOVED`; a STUDENT/GUARDIAN needs `student.remove`, staff needs
   * `workspace.staff.manage` (→ `403`); then every `MEMBER_REMOVAL_BLOCKERS` entry in order
   * (first hit → `409 <code>` with `details.items`). Sets `REMOVED`, `removedAt`,
   * `removalReason`; touches nothing at user level (sessions, other workspaces, assignments
   * history). Audits `member.removed`, then emits `MembershipRemovedEvent`.
   */
  async remove(ctx: MemberCtx, uid: string, reason?: string): Promise<void> {
    const studentGrant = currentGrant('student.remove');
    const staffGrant = currentGrant('workspace.staff.manage');
    if (studentGrant !== 'all' && staffGrant !== 'all') throw permissionDenied();
    if (!UUID.test(uid)) throw notFound();

    const db = tenantDb(ctx.workspaceId);
    const target = await db.membership.findFirst({
      where: { userId: uid, status: { notIn: ENDED } },
      select: { id: true, role: true, status: true },
    });
    if (!target) throw notFound();
    if (target.role === 'OWNER') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'OWNER_CANNOT_BE_REMOVED',
        'The workspace owner cannot be removed',
      );
    }
    const needed = STUDENT_SIDE.includes(target.role) ? studentGrant : staffGrant;
    if (needed !== 'all') throw permissionDenied();

    for (const blocker of this.blockers) {
      const hit = await blocker.check(ctx.workspaceId, uid);
      if (hit) {
        throw new ApiError(HttpStatus.CONFLICT, hit.code, 'The member cannot be removed yet', {
          items: hit.items,
        });
      }
    }

    const removedAt = new Date();
    const removalReason = reason ?? null;
    // Conditional on the status and role read above (never OWNER, checked earlier): a membership
    // promoted to OWNER by a concurrent transfer matches nothing (spec SP1.6 F7).
    const { count } = await db.membership.updateMany({
      where: { id: target.id, status: target.status, role: target.role },
      data: { status: 'REMOVED', removedAt, removalReason },
    });
    // Removed, promoted or otherwise changed concurrently.
    if (count !== 1) throw notFound();

    await this.audit.log({
      action: 'member.removed',
      entityType: 'Membership',
      entityId: target.id,
      before: { status: target.status, role: target.role },
      after: { status: 'REMOVED', removalReason },
    });
    this.publishRemoved(new MembershipRemovedEvent(ctx.workspaceId, uid, target.role));
  }

  /** Scope `own`: STUDENT members assigned to the caller or invited by him. */
  private async ownScope(ctx: MemberCtx): Promise<Prisma.MembershipWhereInput> {
    const assigned = await tenantDb(ctx.workspaceId).teacherStudentAssignment.findMany({
      where: { teacherUserId: ctx.userId },
      select: { studentUserId: true },
    });
    return {
      role: 'STUDENT',
      OR: [
        { userId: { in: assigned.map((a) => a.studentUserId) } },
        { invitedByUserId: ctx.userId },
      ],
    };
  }

  /** Fire-and-forget: the removal is committed, a listener's failure is only logged. */
  private publishRemoved(event: MembershipRemovedEvent): void {
    const failed = (err: unknown) =>
      this.logger.error(
        {
          err: { type: err instanceof Error ? err.name : typeof err },
          workspaceId: event.workspaceId,
          userId: event.userId,
        },
        'MembershipRemovedEvent listener failed',
      );
    try {
      this.events.emitAsync(MEMBERSHIP_REMOVED, event).catch(failed);
    } catch (err) {
      failed(err);
    }
  }
}
