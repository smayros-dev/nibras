import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  Assignment,
  AssignmentsPage,
  AssignmentsQuery,
  CreateAssignmentInput,
} from '@nibras/contracts';
import { Prisma, tenantDb, withTenantTx, type TeacherStudentAssignment } from '@nibras/db';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { validationFailed } from '../workspaces/workspaces.service';
import type { MemberCtx } from './members.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toAssignment(a: TeacherStudentAssignment): Assignment {
  return {
    id: a.id,
    teacherUserId: a.teacherUserId,
    studentUserId: a.studentUserId,
    assignedByUserId: a.assignedByUserId,
    createdAt: a.createdAt.toISOString(),
  };
}

function alreadyAssigned(): ApiError {
  return new ApiError(
    HttpStatus.CONFLICT,
    'ALREADY_ASSIGNED',
    'This student is already assigned to this teacher',
  );
}

/**
 * Teacher ↔ student assignments (PRD §11.2: which teacher sees which student). Every query runs
 * in the route's workspace (`tenantDb` / `withTenantTx`): an id or a user of another workspace is
 * never found here.
 */
@Injectable()
export class AssignmentsService {
  constructor(private readonly audit: AuditService) {}

  /**
   * `GET /workspaces/{wid}/assignments`: filtered by `teacherUserId` / `studentUserId`; with scope
   * `own` only the caller's own assignments (as the teacher). Oldest first (uuidv7 id order);
   * `nextCursor` = the last id of a full page.
   */
  async list(ctx: MemberCtx, q: AssignmentsQuery): Promise<AssignmentsPage> {
    const and: Prisma.TeacherStudentAssignmentWhereInput[] = [];
    if (q.teacherUserId) and.push({ teacherUserId: q.teacherUserId });
    if (q.studentUserId) and.push({ studentUserId: q.studentUserId });
    if (ctx.scope === 'own') and.push({ teacherUserId: ctx.userId });
    if (q.cursor) and.push({ id: { gt: q.cursor } });
    const rows = await tenantDb(ctx.workspaceId).teacherStudentAssignment.findMany({
      where: { AND: and },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit);
    return {
      items: items.map(toAssignment),
      nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null,
    };
  }

  /**
   * `POST /workspaces/{wid}/assignments` (`student.assign`): the teacher must hold an ACTIVE
   * `TEACHER` membership, or an ACTIVE `ADMIN`/`OWNER` one with `canTeach` (§7: an organisation
   * OWNER is the ADMIN column); the student an ACTIVE `STUDENT` one; else `422
   * VALIDATION_FAILED` on that field. An existing pair → `409 ALREADY_ASSIGNED`. Audits
   * `assignment.created`.
   */
  async create(ctx: MemberCtx, input: CreateAssignmentInput): Promise<Assignment> {
    const created = await withTenantTx(ctx.workspaceId, async (tx) => {
      const memberships = await tx.membership.findMany({
        where: {
          userId: { in: [input.teacherUserId, input.studentUserId] },
          status: 'ACTIVE',
        },
        select: { userId: true, role: true, canTeach: true },
      });
      const teacher = memberships.find((m) => m.userId === input.teacherUserId);
      const teaches =
        teacher !== undefined &&
        (teacher.role === 'TEACHER' ||
          ((teacher.role === 'ADMIN' || teacher.role === 'OWNER') && teacher.canTeach));
      if (!teaches) {
        throw validationFailed(
          'teacherUserId',
          'The teacher must be an active teacher (or admin who teaches) of the workspace',
        );
      }
      const student = memberships.find((m) => m.userId === input.studentUserId);
      if (student?.role !== 'STUDENT') {
        throw validationFailed(
          'studentUserId',
          'The student must be an active student of the workspace',
        );
      }
      const existing = await tx.teacherStudentAssignment.findFirst({
        where: { teacherUserId: input.teacherUserId, studentUserId: input.studentUserId },
        select: { id: true },
      });
      if (existing) throw alreadyAssigned();
      try {
        return await tx.teacherStudentAssignment.create({
          data: {
            workspaceId: ctx.workspaceId,
            teacherUserId: input.teacherUserId,
            studentUserId: input.studentUserId,
            assignedByUserId: ctx.userId,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw alreadyAssigned();
        }
        throw err;
      }
    });
    await this.audit.log({
      action: 'assignment.created',
      entityType: 'TeacherStudentAssignment',
      entityId: created.id,
      after: { teacherUserId: created.teacherUserId, studentUserId: created.studentUserId },
    });
    return toAssignment(created);
  }

  /** `DELETE /workspaces/{wid}/assignments/{id}` (`student.assign`). Audits `assignment.deleted`. */
  async remove(ctx: MemberCtx, id: string): Promise<void> {
    if (!UUID.test(id)) throw notFound();
    const db = tenantDb(ctx.workspaceId);
    const current = await db.teacherStudentAssignment.findFirst({ where: { id } });
    if (!current) throw notFound();
    const { count } = await db.teacherStudentAssignment.deleteMany({ where: { id } });
    if (count !== 1) throw notFound();
    await this.audit.log({
      action: 'assignment.deleted',
      entityType: 'TeacherStudentAssignment',
      entityId: id,
      before: { teacherUserId: current.teacherUserId, studentUserId: current.studentUserId },
    });
  }
}

function notFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}
