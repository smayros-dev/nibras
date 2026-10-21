import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  COURSE_ASSIGNED_NOTIFY_JOB,
  QUEUES,
  type CourseAssignedNotifyJob,
  type EnrollResult,
  type EnrollmentSource,
  type EnrollmentsPage,
  type EnrollmentsQuery,
} from '@nibras/contracts';
import {
  tenantDb,
  withTenantTx,
  type Enrollment,
  type MembershipStatus,
  type Prisma,
  type TenantTx,
} from '@nibras/db';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import {
  courseNotFound,
  isUuid,
  loadCourseForWrite,
  ownerFilter,
  type CourseScope,
} from '../courses/course-access';
import { QueueService } from '../queue/queue.service';
import { validationFailed } from '../workspaces/workspaces.service';
import {
  COURSE_ASSIGNED,
  CourseAssignedEvent,
  ENROLLMENT_REVOKED,
  EnrollmentRevokedEvent,
} from './events';

/**
 * Membership statuses a staff member may assign a course to (spec §4.5): ACTIVE, or waiting for a
 * guardian's consent (pre-assigned; access waits for the consent — the `/me` learn routes check
 * the membership is ACTIVE).
 */
const ENROLLABLE: readonly MembershipStatus[] = [
  'ACTIVE',
  'PENDING_GUARDIAN_CONSENT',
  'SUSPENDED_NO_CONSENT',
];

/**
 * The SP2 hooks also pre-assign a student who joined by a code with approval (`PENDING_APPROVAL`):
 * the link's courses are part of what he joined; a rejection revokes them
 * ({@link EnrollmentsService.revokeAllOf}).
 */
const ENROLLABLE_BY_HOOK: readonly MembershipStatus[] = [...ENROLLABLE, 'PENDING_APPROVAL'];

/** How an enrollment is created: manual (staff route) or by a SP2 hook (system actor). */
export interface EnrollOptions {
  /** Default `MANUAL`. */
  source?: EnrollmentSource;
  /**
   * Hooks (`INVITATION` / `INVITE_LINK`): the audit actor is `SYSTEM` (the request's user is the
   * student who accepted) and `PENDING_APPROVAL` members may be pre-assigned.
   */
  system?: boolean;
}

/** One enrollment this call made ACTIVE (created, or reactivated from REVOKED). */
interface Activated {
  id: string;
  studentUserId: string;
  reactivated: boolean;
}

function statusInvalid(status: string): ApiError {
  return new ApiError(
    HttpStatus.CONFLICT,
    'COURSE_STATUS_INVALID',
    'An archived course takes no new assignment',
    { status, allowed: ['DRAFT', 'PUBLISHED'] },
  );
}

/** `422 VALIDATION_FAILED` naming each refused `studentUserIds[i]`. */
function invalidStudents(issues: { index: number; message: string }[]): ApiError {
  return new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', 'Validation failed', {
    issues: issues.map((i) => ({ path: ['studentUserIds', i.index], message: i.message })),
  });
}

const errType = (err: unknown) => ({ type: err instanceof Error ? err.name : typeof err });

/**
 * Enrollments of a course (PRD §8.5.1, §10.8; spec §4.5): batch assignment, revocation,
 * re-assignment (a REVOKED row turns ACTIVE again with its progress) and the list with progress.
 * Every write runs in `withTenantTx(wid)` under the course row lock (`loadCourseForWrite`), so it
 * serialises with the deletion rule's ACTIVE-enrollment count and with concurrent assignments.
 * A course of another workspace, deleted, or outside the caller's scope is `404`.
 */
@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly events: EventEmitter2,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(EnrollmentsService.name);
  }

  /**
   * `POST …/courses/{cid}/enrollments` (`enrollment.manage`). `ARCHIVED` → `409
   * COURSE_STATUS_INVALID`. Each id must be a STUDENT membership of the workspace in an
   * enrollable status; in an ORGANIZATION, scope `own` also needs the student assigned to the
   * caller or invited by him (else `422` with `issues[].path = ['studentUserIds', i]`; nothing is
   * written). New → ACTIVE; REVOKED → ACTIVE (progress kept, `activatedAt` now, revocation
   * cleared); ACTIVE → unchanged (`created: false`). Audits `enrollment.created` per row made
   * ACTIVE; after the commit, a PUBLISHED course enqueues one `course.assigned_notify` with those
   * ids and emits {@link CourseAssignedEvent} (a DRAFT course notifies at publication).
   */
  async enroll(
    ctx: CourseScope,
    cid: string,
    studentUserIds: readonly string[],
    opts: EnrollOptions = {},
  ): Promise<EnrollResult> {
    const source = opts.source ?? 'MANUAL';
    const { items, activated, courseStatus } = await withTenantTx(ctx.workspaceId, async (tx) => {
      const course = await loadCourseForWrite(tx, ctx, cid);
      if (course.status === 'ARCHIVED') throw statusInvalid(course.status);
      await this.assertEnrollable(tx, ctx, studentUserIds, opts.system === true);

      const existing = new Map(
        (
          await tx.enrollment.findMany({
            where: { courseId: cid, studentUserId: { in: [...studentUserIds] } },
            select: { id: true, studentUserId: true, status: true },
          })
        ).map((e) => [e.studentUserId, e]),
      );
      const now = new Date();
      const activated: Activated[] = [];
      const items: EnrollResult['items'] = [];
      for (const studentUserId of studentUserIds) {
        const row = existing.get(studentUserId);
        if (row?.status === 'ACTIVE') {
          items.push({ studentUserId, status: 'ACTIVE', created: false });
          continue;
        }
        const data = { status: 'ACTIVE' as const, assignedByUserId: ctx.userId, source };
        const saved = row
          ? await tx.enrollment.update({
              where: { id: row.id },
              data: { ...data, activatedAt: now, revokedAt: null, revokedReason: null },
              select: { id: true },
            })
          : await tx.enrollment.create({
              data: {
                ...data,
                workspaceId: ctx.workspaceId,
                courseId: cid,
                studentUserId,
                activatedAt: now,
              },
              select: { id: true },
            });
        activated.push({ id: saved.id, studentUserId, reactivated: row !== undefined });
        items.push({ studentUserId, status: 'ACTIVE', created: true });
      }
      return { items, activated, courseStatus: course.status };
    });

    for (const a of activated) {
      await this.audit.log({
        action: 'enrollment.created',
        entityType: 'Enrollment',
        entityId: a.id,
        workspaceId: ctx.workspaceId,
        after: {
          courseId: cid,
          studentUserId: a.studentUserId,
          source,
          assignedByUserId: ctx.userId,
          reactivated: a.reactivated,
        },
        ...(opts.system && { actorOverride: { role: 'SYSTEM' } }),
      });
    }
    if (courseStatus === 'PUBLISHED' && activated.length > 0) {
      await this.enqueueAssigned(ctx.workspaceId, cid, activated);
      this.publish(
        COURSE_ASSIGNED,
        new CourseAssignedEvent(
          ctx.workspaceId,
          cid,
          activated.map((a) => a.id),
          activated.map((a) => a.studentUserId),
          ctx.userId,
        ),
      );
    }
    return { items };
  }

  /**
   * `DELETE …/courses/{cid}/enrollments/{uid}` (`enrollment.manage`; scope `own`: the course must
   * be the caller's). ACTIVE → REVOKED (`revokedAt`, optional `revokedReason`), progress kept;
   * audits `enrollment.revoked` and emits {@link EnrollmentRevokedEvent} after the commit.
   * Already REVOKED → no-op (`204`); no enrollment → `404`.
   */
  async revoke(ctx: CourseScope, cid: string, uid: string, reason?: string): Promise<void> {
    if (!isUuid(uid)) throw courseNotFound();
    const revoked = await withTenantTx(ctx.workspaceId, async (tx) => {
      await loadCourseForWrite(tx, ctx, cid);
      const row = await tx.enrollment.findFirst({
        where: { courseId: cid, studentUserId: uid },
        select: { id: true, status: true },
      });
      if (!row) throw courseNotFound();
      if (row.status === 'REVOKED') return null;
      await tx.enrollment.update({
        where: { id: row.id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason || null },
      });
      return row.id;
    });
    if (!revoked) return;
    await this.audit.log({
      action: 'enrollment.revoked',
      entityType: 'Enrollment',
      entityId: revoked,
      workspaceId: ctx.workspaceId,
      before: { status: 'ACTIVE' },
      after: { status: 'REVOKED', courseId: cid, studentUserId: uid, reason: reason || null },
    });
    this.publish(ENROLLMENT_REVOKED, new EnrollmentRevokedEvent(ctx.workspaceId, cid, uid));
  }

  /**
   * Every ACTIVE enrollment of `studentUserId` in the workspace → REVOKED (`reason`), audited as
   * `SYSTEM`, one {@link EnrollmentRevokedEvent} each. Used when SP2 rejects a membership that a
   * hook pre-assigned. Returns the number of rows revoked.
   */
  async revokeAllOf(workspaceId: string, studentUserId: string, reason: string): Promise<number> {
    const rows = await withTenantTx(workspaceId, async (tx) => {
      const active = await tx.enrollment.findMany({
        where: { studentUserId, status: 'ACTIVE' },
        select: { id: true, courseId: true },
      });
      if (active.length === 0) return active;
      await tx.enrollment.updateMany({
        where: { id: { in: active.map((r) => r.id) }, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason },
      });
      return active;
    });
    for (const row of rows) {
      await this.audit.log({
        action: 'enrollment.revoked',
        entityType: 'Enrollment',
        entityId: row.id,
        workspaceId,
        before: { status: 'ACTIVE' },
        after: { status: 'REVOKED', courseId: row.courseId, studentUserId, reason },
        actorOverride: { role: 'SYSTEM' },
      });
      this.publish(
        ENROLLMENT_REVOKED,
        new EnrollmentRevokedEvent(workspaceId, row.courseId, studentUserId),
      );
    }
    return rows.length;
  }

  /**
   * `GET …/courses/{cid}/enrollments` and `…/progress` (`progress.read`): the course's enrolled
   * students in assignment order (`createdAt`, `id`), with their progress; `status` filters,
   * `cursor` = an enrollment id of this course (else `422 VALIDATION_FAILED` on `cursor`).
   */
  async list(ctx: CourseScope, cid: string, q: EnrollmentsQuery): Promise<EnrollmentsPage> {
    if (!isUuid(cid)) throw courseNotFound();
    const db = tenantDb(ctx.workspaceId);
    const course = await db.course.findFirst({
      where: { id: cid, deletedAt: null, ...ownerFilter(ctx) },
      select: { id: true },
    });
    if (!course) throw courseNotFound();
    const where: Prisma.EnrollmentWhereInput = {
      courseId: cid,
      ...(q.status && { status: q.status }),
    };
    if (q.cursor !== undefined) {
      const at = await db.enrollment.findFirst({
        where: { ...where, id: q.cursor },
        select: { id: true },
      });
      if (!at) throw validationFailed('cursor', 'Unknown cursor');
    }
    const rows = await db.enrollment.findMany({
      where,
      include: { student: { select: { firstName: true, lastName: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      ...(q.cursor !== undefined && { cursor: { id: q.cursor }, skip: 1 }),
    });
    const items = rows.slice(0, q.limit);
    return {
      items: items.map((e) => toSummary(e)),
      nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null,
    };
  }

  /**
   * Every id is a STUDENT membership of the transaction's workspace in an enrollable status and,
   * for scope `own` in an ORGANIZATION, assigned to the caller or invited by him. All refused
   * indexes are reported at once.
   */
  private async assertEnrollable(
    tx: TenantTx,
    ctx: CourseScope,
    ids: readonly string[],
    system: boolean,
  ): Promise<void> {
    const allowed = system ? ENROLLABLE_BY_HOOK : ENROLLABLE;
    const members = new Map(
      (
        await tx.membership.findMany({
          where: { userId: { in: [...ids] } },
          select: { userId: true, role: true, status: true, invitedByUserId: true },
        })
      ).map((m) => [m.userId, m]),
    );
    let inScope: ((uid: string) => boolean) | undefined;
    if (ctx.scope === 'own') {
      const workspace = await tx.workspace.findUnique({
        where: { id: ctx.workspaceId },
        select: { type: true },
      });
      if (workspace?.type === 'ORGANIZATION') {
        const assigned = new Set(
          (
            await tx.teacherStudentAssignment.findMany({
              where: { teacherUserId: ctx.userId, studentUserId: { in: [...ids] } },
              select: { studentUserId: true },
            })
          ).map((a) => a.studentUserId),
        );
        inScope = (uid) => assigned.has(uid) || members.get(uid)?.invitedByUserId === ctx.userId;
      }
    }
    const issues: { index: number; message: string }[] = [];
    ids.forEach((uid, index) => {
      const m = members.get(uid);
      if (!m || m.role !== 'STUDENT') {
        issues.push({ index, message: 'Not a student of this workspace' });
      } else if (!allowed.includes(m.status)) {
        issues.push({ index, message: `Membership ${m.status} cannot be assigned a course` });
      } else if (inScope && !inScope(uid)) {
        issues.push({ index, message: 'Not a student assigned to you' });
      }
    });
    if (issues.length > 0) throw invalidStudents(issues);
  }

  /** The interim `course.assigned` emails (spec D14); a failed enqueue is logged, never thrown. */
  private async enqueueAssigned(workspaceId: string, courseId: string, activated: Activated[]) {
    const data: CourseAssignedNotifyJob = {
      workspaceId,
      enrollmentIds: activated.map((a) => a.id),
    };
    try {
      await this.queue.add(QUEUES.notifications, COURSE_ASSIGNED_NOTIFY_JOB, data);
    } catch (err) {
      this.logger.error(
        { courseId, workspace_id: workspaceId, err: errType(err) },
        'course assigned notifications not enqueued',
      );
    }
  }

  /** Fire-and-forget: the change is committed, a listener's failure is only logged. */
  private publish(name: string, event: object): void {
    const failed = (err: unknown) =>
      this.logger.error({ event: name, err: errType(err) }, 'enrollment event listener failed');
    try {
      this.events.emitAsync(name, event).catch(failed);
    } catch (err) {
      failed(err);
    }
  }
}

type EnrollmentRow = Enrollment & { student: { firstName: string; lastName: string } };

function toSummary(e: EnrollmentRow): EnrollmentsPage['items'][number] {
  return {
    studentUserId: e.studentUserId,
    firstName: e.student.firstName,
    lastName: e.student.lastName,
    status: e.status,
    source: e.source,
    activatedAt: e.activatedAt.toISOString(),
    revokedAt: e.revokedAt?.toISOString() ?? null,
    progressPercent: e.progressPercent,
    completedAt: e.completedAt?.toISOString() ?? null,
    lastActivityAt: e.lastActivityAt?.toISOString() ?? null,
  };
}
