import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  generateOpaqueToken,
  INVITATION_RESEND_WINDOW_S,
  INVITATION_TTL_MS,
  type CreateInvitationInput,
  type InvitationStatus,
  type InvitationSummary,
  type InvitationsPage,
  type InvitationsQuery,
  type UpdateInvitationInput,
} from '@nibras/contracts';
import { Prisma, tenantDb, type GuardedClient, type Invitation, type User } from '@nibras/db';
import { AuditService } from '../audit/audit.service';
import { rateLimited } from '../auth/rate-window';
import { ApiError } from '../common/api-error';
import { RequestContext } from '../common/request-context';
import { DB } from '../db/db.module';
import { memberCtx, type MemberCtx } from '../members/members.service';
import { currentGrant, permissionDenied } from '../tenancy/permissions';
import { validationFailed } from '../workspaces/workspaces.service';
import { InvitationMailerService, type InvitationMailWorkspace } from './invitation-mailer.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Stored statuses an invitation can still be edited, resent or revoked from. */
const OPEN: Invitation['status'][] = ['PENDING', 'EXPIRED'];
/** Memberships that are over: their address may be invited again. */
const ENDED = ['REMOVED', 'REJECTED'] as const;
const STAFF_ROLES = ['TEACHER', 'ADMIN'] as const;

type InvitationRow = Invitation & { invitedBy: Pick<User, 'firstName' | 'lastName'> };
const INVITER = { select: { firstName: true, lastName: true } } as const;

/**
 * The status the staff sees: a stored `PENDING` past `expiresAt` is `EXPIRED` (the daily job
 * flips the stored value later).
 */
export function derivedStatus(
  row: Pick<Invitation, 'status' | 'expiresAt'>,
  now: Date = new Date(),
): InvitationStatus {
  return row.status === 'PENDING' && row.expiresAt <= now ? 'EXPIRED' : row.status;
}

/** `where` of a derived status. */
function statusWhere(status: InvitationStatus, now: Date): Prisma.InvitationWhereInput {
  switch (status) {
    case 'PENDING':
      return { status: 'PENDING', expiresAt: { gt: now } };
    case 'EXPIRED':
      return { OR: [{ status: 'EXPIRED' }, { status: 'PENDING', expiresAt: { lte: now } }] };
    default:
      return { status };
  }
}

function toSummary(row: InvitationRow, now: Date = new Date()): InvitationSummary {
  return {
    id: row.id,
    email: row.email,
    role: row.role as InvitationSummary['role'],
    firstName: row.firstName,
    lastName: row.lastName,
    guardianEmail: row.guardianEmail,
    status: derivedStatus(row, now),
    expiresAt: row.expiresAt.toISOString(),
    invitedByUserId: row.invitedByUserId,
    invitedByName: `${row.invitedBy.firstName} ${row.invitedBy.lastName}`.trim(),
    teacherUserId: row.teacherUserId,
    courseIds: row.courseIds,
    resentCount: row.resentCount,
    lastSentAt: row.lastSentAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function notFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}

function pendingConflict(invitationId: string): ApiError {
  return new ApiError(
    HttpStatus.CONFLICT,
    'INVITATION_PENDING',
    'An invitation is already pending for this address',
    { invitationId },
  );
}

/** `409` for a row that left the open statuses (accepted or revoked). */
function closedConflict(status: Invitation['status']): ApiError {
  return status === 'ACCEPTED'
    ? new ApiError(
        HttpStatus.CONFLICT,
        'INVITATION_ALREADY_ACCEPTED',
        'This invitation was already accepted',
      )
    : new ApiError(HttpStatus.CONFLICT, 'INVITATION_REVOKED', 'This invitation was revoked');
}

/** A unique violation (`P2002`) on anything but the token hash: the pending-per-email index. */
function pendingIndexViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target);
  return !/token/i.test(text);
}

/**
 * The caller's `MemberCtx` for invitations. `student.invite` is ✅ for a TEACHER in the §7
 * matrix, but the plan's scope rule is narrower: an organisation TEACHER sees and manages only
 * the invitations he created (`own`); OWNER and ADMIN see all of them.
 */
export function invitationCtx(wid: string): MemberCtx {
  const ctx = memberCtx(wid);
  const role = RequestContext.get()?.membership?.role;
  return { ...ctx, scope: role === 'OWNER' || role === 'ADMIN' ? 'all' : 'own' };
}

/**
 * Email invitations of a workspace (PRD §8.3.1, §8.2.2; design §4.1). Every query runs through
 * `tenantDb(wid)`: an id of another workspace is never found (404). Staff rows (`TEACHER` /
 * `ADMIN`) are visible and manageable only with `workspace.staff.manage` = `all`.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'workspace' | 'user'>,
    private readonly audit: AuditService,
    private readonly mailer: InvitationMailerService,
  ) {}

  /**
   * `POST /workspaces/{wid}/invitations`. Staff roles need an ORGANIZATION (`422
   * INVITATION_ROLE_NOT_ALLOWED`) and `workspace.staff.manage` (`403`). `teacherUserId`: a STUDENT
   * invitation of an organisation only; OWNER/ADMIN may name any ACTIVE teaching member (else
   * `422 VALIDATION_FAILED`), a TEACHER only himself (`403`) and is the implicit teacher. A live
   * membership of the address (any status but REMOVED/REJECTED) → `409 ALREADY_MEMBER`; a stored
   * `PENDING` invitation → `409 INVITATION_PENDING` (`details.invitationId`; the partial unique
   * index decides under races). Audits `invitation.created`, then emails the link inline.
   */
  async create(ctx: MemberCtx, input: CreateInvitationInput): Promise<InvitationSummary> {
    const workspace = await this.workspace(ctx.workspaceId);
    const staffInvite = (STAFF_ROLES as readonly string[]).includes(input.role);
    if (staffInvite) {
      if (workspace.type !== 'ORGANIZATION') {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'INVITATION_ROLE_NOT_ALLOWED',
          'Teachers and admins can only be invited into an organisation',
        );
      }
      if (currentGrant('workspace.staff.manage') !== 'all') throw permissionDenied();
    }
    const teacherUserId = await this.teacherFor(ctx, workspace.type, staffInvite, input);
    const db = tenantDb(ctx.workspaceId);

    const member = await db.membership.findFirst({
      where: { user: { email: input.email }, status: { notIn: [...ENDED] } },
      select: { id: true },
    });
    if (member) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'ALREADY_MEMBER',
        'This address already belongs to a member of the workspace',
      );
    }
    const pending = await db.invitation.findFirst({
      where: { email: input.email, status: 'PENDING' },
      select: { id: true },
    });
    if (pending) throw pendingConflict(pending.id);

    const { raw, hash } = generateOpaqueToken();
    const now = new Date();
    let row: InvitationRow;
    try {
      row = await db.invitation.create({
        data: {
          workspaceId: ctx.workspaceId,
          email: input.email,
          role: input.role,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          guardianEmail: input.guardianEmail ?? null,
          birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null,
          tokenHash: hash,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
          status: 'PENDING',
          invitedByUserId: ctx.userId,
          message: input.message || null,
          courseIds: input.courseIds,
          teacherUserId,
          lastSentAt: now,
        },
        include: { invitedBy: INVITER },
      });
    } catch (err) {
      if (pendingIndexViolation(err)) {
        const winner = await db.invitation.findFirst({
          where: { email: input.email, status: 'PENDING' },
          select: { id: true },
        });
        if (winner) throw pendingConflict(winner.id);
      }
      throw err;
    }
    await this.audit.log({
      action: 'invitation.created',
      entityType: 'Invitation',
      entityId: row.id,
      after: {
        email: row.email,
        role: row.role,
        expiresAt: row.expiresAt,
        teacherUserId: row.teacherUserId,
      },
    });
    await this.mailer.sendInvitation(row, raw, row.invitedBy, workspace);
    return toSummary(row, now);
  }

  /**
   * `GET /workspaces/{wid}/invitations`. Scope `own` → the caller's invitations; staff rows only
   * with `workspace.staff.manage` = `all`. `status` filters on the derived status, `q` is a
   * case-insensitive substring of the email or names. Newest first (`createdAt desc, id desc`);
   * `cursor` = an invitation id of this workspace (else `422 VALIDATION_FAILED`).
   */
  async list(ctx: MemberCtx, q: InvitationsQuery): Promise<InvitationsPage> {
    const now = new Date();
    const db = tenantDb(ctx.workspaceId);
    const and: Prisma.InvitationWhereInput[] = [this.visible(ctx)];
    if (q.status) and.push(statusWhere(q.status, now));
    if (q.role) and.push({ role: q.role });
    if (q.q) {
      const contains = { contains: q.q, mode: 'insensitive' } as const;
      and.push({ OR: [{ email: contains }, { firstName: contains }, { lastName: contains }] });
    }
    if (q.cursor) {
      const at = await db.invitation.findFirst({
        where: { id: q.cursor },
        select: { id: true, createdAt: true },
      });
      if (!at) throw validationFailed('cursor', 'Unknown cursor');
      and.push({
        OR: [{ createdAt: { lt: at.createdAt } }, { createdAt: at.createdAt, id: { lt: at.id } }],
      });
    }
    const rows = await db.invitation.findMany({
      where: { AND: and },
      include: { invitedBy: INVITER },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit);
    return {
      items: items.map((r) => toSummary(r, now)),
      nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null,
    };
  }

  /** `GET /workspaces/{wid}/invitations/{id}`: same visibility as the list (outside → 404). */
  async get(ctx: MemberCtx, id: string): Promise<InvitationSummary> {
    return toSummary(await this.find(ctx, id));
  }

  /**
   * `PATCH /workspaces/{wid}/invitations/{id}`: names, guardian email (`null` clears; must differ
   * from the invited address) and message of a `PENDING` / `EXPIRED` invitation (else `409`).
   * Audits `invitation.updated` with before/after of the fields that changed (none → no write).
   */
  async update(
    ctx: MemberCtx,
    id: string,
    input: UpdateInvitationInput,
  ): Promise<InvitationSummary> {
    const current = await this.find(ctx, id);
    if (!OPEN.includes(current.status)) throw closedConflict(current.status);
    if (input.guardianEmail && input.guardianEmail === current.email) {
      throw validationFailed(
        'guardianEmail',
        'The guardian email must differ from the invited email',
      );
    }
    const fields = ['firstName', 'lastName', 'guardianEmail', 'message'] as const;
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of fields) {
      const value = key === 'message' && input.message === '' ? null : input[key];
      if (value === undefined || value === current[key]) continue;
      before[key] = current[key];
      after[key] = value;
    }
    if (Object.keys(after).length === 0) return toSummary(current);

    const db = tenantDb(ctx.workspaceId);
    const { count } = await db.invitation.updateMany({
      where: { id: current.id, status: { in: OPEN } },
      data: after,
    });
    if (count !== 1) throw closedConflict((await this.find(ctx, id)).status);
    await this.audit.log({
      action: 'invitation.updated',
      entityType: 'Invitation',
      entityId: current.id,
      before,
      after,
    });
    return toSummary(await this.find(ctx, id));
  }

  /**
   * `POST /workspaces/{wid}/invitations/{id}/resend` (AC-INV-04): from `PENDING` / `EXPIRED`
   * only (else `409`); sent less than `INVITATION_RESEND_WINDOW_S` ago → `429 RATE_LIMITED` with
   * `details.retryAfterS`. A new token replaces the old hash (the previous link stops working),
   * `expiresAt = now + 7 d`, status `PENDING`, `resentCount + 1` — one conditional update, so two
   * concurrent resends send one email. Audits `invitation.resent`, then emails the new link.
   */
  async resend(ctx: MemberCtx, id: string): Promise<InvitationSummary> {
    const current = await this.find(ctx, id);
    if (!OPEN.includes(current.status)) throw closedConflict(current.status);
    const now = new Date();
    this.assertCooldown(current, now);

    const { raw, hash } = generateOpaqueToken();
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
    const db = tenantDb(ctx.workspaceId);
    let count: number;
    try {
      ({ count } = await db.invitation.updateMany({
        where: {
          id: current.id,
          status: { in: OPEN },
          lastSentAt: { lte: new Date(now.getTime() - INVITATION_RESEND_WINDOW_S * 1000) },
        },
        data: {
          tokenHash: hash,
          expiresAt,
          status: 'PENDING',
          resentCount: { increment: 1 },
          lastSentAt: now,
        },
      }));
    } catch (err) {
      // A stored EXPIRED row coming back to PENDING while a newer invitation is pending.
      if (pendingIndexViolation(err)) {
        const other = await db.invitation.findFirst({
          where: { email: current.email, status: 'PENDING' },
          select: { id: true },
        });
        if (other) throw pendingConflict(other.id);
      }
      throw err;
    }
    if (count !== 1) {
      // Changed concurrently: revoked / accepted, or resent by another request.
      const latest = await this.find(ctx, id);
      if (!OPEN.includes(latest.status)) throw closedConflict(latest.status);
      this.assertCooldown(latest, new Date());
      // Still open and out of the window: another request resent it in between.
      throw rateLimited(INVITATION_RESEND_WINDOW_S, 'Invitation already sent, try again later');
    }
    const row = await this.find(ctx, id);
    await this.audit.log({
      action: 'invitation.resent',
      entityType: 'Invitation',
      entityId: row.id,
      after: { resentCount: row.resentCount, expiresAt: row.expiresAt },
    });
    await this.mailer.sendInvitation(
      row,
      raw,
      row.invitedBy,
      await this.workspace(ctx.workspaceId),
    );
    return toSummary(row);
  }

  /**
   * `DELETE /workspaces/{wid}/invitations/{id}` (AC-INV-05): `PENDING` / `EXPIRED` → `REVOKED`
   * with `revokedAt` (else `409`); the link then answers `410 INVITATION_REVOKED`. Audits
   * `invitation.revoked`.
   */
  async revoke(ctx: MemberCtx, id: string): Promise<void> {
    const current = await this.find(ctx, id);
    if (!OPEN.includes(current.status)) throw closedConflict(current.status);
    const revokedAt = new Date();
    const { count } = await tenantDb(ctx.workspaceId).invitation.updateMany({
      where: { id: current.id, status: { in: OPEN } },
      data: { status: 'REVOKED', revokedAt },
    });
    if (count !== 1) throw closedConflict((await this.find(ctx, id)).status);
    await this.audit.log({
      action: 'invitation.revoked',
      entityType: 'Invitation',
      entityId: current.id,
      before: { status: derivedStatus(current, revokedAt) },
      after: { status: 'REVOKED', revokedAt },
    });
  }

  /** `429` while the last send is younger than the resend window. */
  private assertCooldown(row: Pick<Invitation, 'lastSentAt'>, now: Date): void {
    const elapsedS = (now.getTime() - row.lastSentAt.getTime()) / 1000;
    if (elapsedS < INVITATION_RESEND_WINDOW_S) {
      throw rateLimited(
        Math.max(1, Math.ceil(INVITATION_RESEND_WINDOW_S - elapsedS)),
        'Invitation already sent, try again later',
      );
    }
  }

  /** Rows the caller may see: his own under scope `own`; staff rows need staff management. */
  private visible(ctx: MemberCtx): Prisma.InvitationWhereInput {
    const where: Prisma.InvitationWhereInput = {};
    if (ctx.scope === 'own') where.invitedByUserId = ctx.userId;
    if (currentGrant('workspace.staff.manage') !== 'all') where.role = 'STUDENT';
    return where;
  }

  /** One visible invitation of the route's workspace, else `404`. */
  private async find(ctx: MemberCtx, id: string): Promise<InvitationRow> {
    if (!UUID.test(id)) throw notFound();
    const row = await tenantDb(ctx.workspaceId).invitation.findFirst({
      where: { AND: [{ id }, this.visible(ctx)] },
      include: { invitedBy: INVITER },
    });
    if (!row) throw notFound();
    return row;
  }

  private async workspace(
    wid: string,
  ): Promise<InvitationMailWorkspace & { type: 'PERSONAL' | 'ORGANIZATION' }> {
    return this.db.workspace.findUniqueOrThrow({
      where: { id: wid },
      select: { id: true, type: true, name: true, defaultLocale: true, defaultTimezone: true },
    });
  }

  /** The teacher a STUDENT invitation assigns at acceptance (see {@link studentTeacherFor}). */
  private teacherFor(
    ctx: MemberCtx,
    workspaceType: 'PERSONAL' | 'ORGANIZATION',
    staffInvite: boolean,
    input: CreateInvitationInput,
  ): Promise<string | null> {
    return studentTeacherFor(
      ctx,
      workspaceType === 'ORGANIZATION' && !staffInvite,
      input.teacherUserId,
    );
  }
}

/**
 * The teacher a STUDENT invitation or invite link assigns at acceptance (organisations only:
 * `assignable` false + a requested teacher → `422 VALIDATION_FAILED` on `teacherUserId`). Scope
 * `own` (organisation TEACHER): the caller is the implicit and only allowed teacher (another id →
 * `403`); scope `all`: an ACTIVE `TEACHER` or an ACTIVE `ADMIN`/`OWNER` with `canTeach` of the
 * route's workspace (else `422`), or nobody.
 */
export async function studentTeacherFor(
  ctx: MemberCtx,
  assignable: boolean,
  requested: string | undefined,
): Promise<string | null> {
  if (!assignable) {
    if (requested !== undefined) {
      throw validationFailed(
        'teacherUserId',
        'A teacher is only assigned to a student invitation of an organisation',
      );
    }
    return null;
  }
  if (ctx.scope === 'own') {
    if (requested !== undefined && requested !== ctx.userId) throw permissionDenied();
    return ctx.userId;
  }
  if (requested === undefined) return null;
  const teacher = await tenantDb(ctx.workspaceId).membership.findFirst({
    where: { userId: requested, status: 'ACTIVE' },
    select: { role: true, canTeach: true },
  });
  const teaches =
    teacher !== null &&
    (teacher.role === 'TEACHER' ||
      ((teacher.role === 'ADMIN' || teacher.role === 'OWNER') && teacher.canTeach));
  if (!teaches) {
    throw validationFailed(
      'teacherUserId',
      'The teacher must be an active teacher (or admin who teaches) of the workspace',
    );
  }
  return requested;
}
