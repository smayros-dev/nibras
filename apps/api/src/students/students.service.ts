import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  isMinor,
  maskEmail,
  type StudentProfile,
  type StudentSummary,
  type StudentsPage,
  type StudentsQuery,
  type UpdateStudentInput,
} from '@nibras/contracts';
import {
  tenantDb,
  type GuardedClient,
  type GuardianLink,
  type Membership,
  type MembershipStatus,
  type Prisma,
  type User,
} from '@nibras/db';
import { ApiError } from '../common/api-error';
import { RequestContext } from '../common/request-context';
import { DB } from '../db/db.module';
import { GuardianService, guardianInfo } from '../guardian/guardian.service';
import {
  afterMemberCursor,
  decodeMemberCursor,
  encodeMemberCursor,
  memberCtx,
  ownScope,
  type MemberCtx,
} from '../members/members.service';
import { permissionDenied } from '../tenancy/permissions';
import { validationFailed } from '../workspaces/workspaces.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Memberships that are over: listed only when asked for by `status`. */
const ENDED: MembershipStatus[] = ['REMOVED', 'REJECTED'];

const USER_FIELDS = { firstName: true, lastName: true, email: true, birthDate: true } as const;
type StudentRow = Membership & {
  user: Pick<User, 'firstName' | 'lastName' | 'email' | 'birthDate'>;
};
type LinkRow = Pick<
  GuardianLink,
  'studentUserId' | 'guardianEmail' | 'status' | 'consentExpiresAt'
>;

/**
 * The caller's `MemberCtx` on a students route: an OWNER (personal or organisation) or ADMIN
 * reads every student with emails (`all`: every student of a personal workspace is its owner's,
 * like `invitationCtx`); an organisation TEACHER / ASSISTANT and a STUDENT read with scope `own`.
 */
export function studentCtx(wid: string): MemberCtx {
  const ctx = memberCtx(wid);
  const role = RequestContext.get()?.membership?.role;
  return { ...ctx, scope: role === 'OWNER' || role === 'ADMIN' ? 'all' : 'own' };
}

function notFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}

const birthDateOf = (user: Pick<User, 'birthDate'>): string | undefined =>
  user.birthDate?.toISOString().slice(0, 10);

/** A student whose birth date makes him a minor today (no birth date: not a known minor). */
function minor(user: Pick<User, 'birthDate'>): boolean {
  const birthDate = birthDateOf(user);
  return birthDate !== undefined && isMinor(birthDate);
}

/**
 * Whether the caller reads a student's guardian email in clear (Q7): scope `all`, or the student
 * was invited by the caller (he typed that address, or the student did on his invitation).
 */
function seesGuardianEmail(ctx: MemberCtx, m: Pick<Membership, 'invitedByUserId'>): boolean {
  return ctx.scope === 'all' || m.invitedByUserId === ctx.userId;
}

function toSummary(m: StudentRow, link: LinkRow | undefined, ctx: MemberCtx): StudentSummary {
  return {
    userId: m.userId,
    firstName: m.user.firstName,
    lastName: m.user.lastName,
    ...(ctx.scope === 'all' && { email: m.user.email }),
    status: m.status,
    joinedAt: m.joinedAt?.toISOString() ?? null,
    invitedByUserId: m.invitedByUserId,
    isMinor: minor(m.user),
    guardian: link
      ? {
          ...guardianInfo(link),
          ...(seesGuardianEmail(ctx, m) && { email: link.guardianEmail }),
        }
      : null,
    progressPercent: null,
    attendanceRate: null,
    lastActivityAt: null,
    courses: [],
  };
}

/**
 * The students of a workspace (PRD §8.3, §9.1; design §4.5): STUDENT memberships with their
 * guardian link, the profile skeleton later sub-projects extend, and the guardian email change.
 * Every membership and link query runs through `tenantDb(wid)`: a uid of another workspace is
 * never found (404), and the guardian links read are this workspace's only.
 */
@Injectable()
export class StudentsService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'user'>,
    private readonly guardian: GuardianService,
  ) {}

  /**
   * `GET /workspaces/{wid}/students`. Without `status`, `REMOVED`/`REJECTED` are left out. `q`
   * is a case-insensitive substring of the first name, last name or (scope `all` only) email.
   * Keyset pagination on (last name, first name, user id), the members cursor.
   */
  async list(ctx: MemberCtx, q: StudentsQuery): Promise<StudentsPage> {
    const cursor = q.cursor === undefined ? undefined : await this.cursorIn(ctx, q.cursor);
    const and: Prisma.MembershipWhereInput[] = [
      { role: 'STUDENT' },
      q.status ? { status: q.status } : { status: { notIn: ENDED } },
      await this.scope(ctx),
    ];
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
    if (cursor) and.push(afterMemberCursor(cursor));

    const db = tenantDb(ctx.workspaceId);
    const rows = await db.membership.findMany({
      where: { AND: and },
      include: { user: { select: USER_FIELDS } },
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }, { userId: 'asc' }],
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit);
    const links = await db.guardianLink.findMany({
      where: { studentUserId: { in: items.map((m) => m.userId) } },
      select: { studentUserId: true, guardianEmail: true, status: true, consentExpiresAt: true },
    });
    const byStudent = new Map(links.map((l) => [l.studentUserId, l]));
    return {
      items: items.map((m) => toSummary(m, byStudent.get(m.userId), ctx)),
      nextCursor: rows.length > q.limit ? encodeMemberCursor(items[items.length - 1]!) : null,
    };
  }

  /**
   * `GET /workspaces/{wid}/students/{uid}/profile`: a STUDENT of this workspace in the caller's
   * scope, any status (`REMOVED` included, §8.3.6), else `404`. The inviter and the assigned
   * teachers (those still members) by name; the sections later sub-projects fill are empty.
   */
  async profile(ctx: MemberCtx, uid: string): Promise<StudentProfile> {
    if (!UUID.test(uid)) throw notFound();
    const db = tenantDb(ctx.workspaceId);
    const m = await db.membership.findFirst({
      where: { AND: [{ userId: uid, role: 'STUDENT' }, await this.scope(ctx)] },
      include: {
        user: {
          select: { ...USER_FIELDS, locale: true, timezone: true },
        },
      },
    });
    if (!m) throw notFound();

    const [invitedBy, link, assignments] = await Promise.all([
      m.invitedByUserId
        ? this.db.user.findUnique({
            where: { id: m.invitedByUserId },
            select: { firstName: true, lastName: true },
          })
        : null,
      db.guardianLink.findFirst({ where: { studentUserId: uid } }),
      db.teacherStudentAssignment.findMany({
        where: { studentUserId: uid },
        select: { teacher: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const live = await db.membership.findMany({
      where: {
        userId: { in: assignments.map((a) => a.teacher.id) },
        status: { notIn: ENDED },
      },
      select: { userId: true },
    });
    const liveIds = new Set(live.map((l) => l.userId));
    const consent =
      link?.consentId && (link.status === 'ACTIVE' || link.status === 'REVOKED')
        ? await db.consent.findFirst({
            where: { id: link.consentId },
            select: { grantedAt: true },
          })
        : null;

    return {
      user: {
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        ...(ctx.scope === 'all' && { email: m.user.email }),
        locale: m.user.locale,
        timezone: m.user.timezone,
        isMinor: minor(m.user),
      },
      membership: {
        status: m.status,
        joinedAt: m.joinedAt?.toISOString() ?? null,
        invitedBy: invitedBy
          ? { firstName: invitedBy.firstName, lastName: invitedBy.lastName }
          : null,
        removedAt: m.removedAt?.toISOString() ?? null,
      },
      guardian: link
        ? {
            ...(seesGuardianEmail(ctx, m) && { email: link.guardianEmail }),
            emailMasked: maskEmail(link.guardianEmail),
            firstName: link.guardianFirstName,
            lastName: link.guardianLastName,
            relationship: link.relationship,
            status: link.status,
            grantedAt: consent?.grantedAt.toISOString() ?? null,
            consentExpiresAt: link.consentExpiresAt?.toISOString() ?? null,
            revokedAt: link.status === 'REVOKED' ? (link.revokedAt?.toISOString() ?? null) : null,
          }
        : null,
      assignedTeachers: assignments
        .filter((a) => liveIds.has(a.teacher.id))
        .map((a) => ({
          userId: a.teacher.id,
          firstName: a.teacher.firstName,
          lastName: a.teacher.lastName,
        })),
      courses: [],
      progress: null,
      sessions: [],
      attendance: null,
      reports: [],
      activity: [],
    };
  }

  /**
   * `PATCH /workspaces/{wid}/students/{uid}` (`student.update`): the guardian email of a minor
   * (see `GuardianService.changeEmail`). A STUDENT caller (`student.update` = `own` in §7) never
   * changes his own guardian's address (`403`): that would let a minor redirect the consent
   * request to himself. Returns the student as the list shows him.
   */
  async update(ctx: MemberCtx, uid: string, input: UpdateStudentInput): Promise<StudentSummary> {
    if (RequestContext.get()?.membership?.role === 'STUDENT') throw permissionDenied();
    if (!UUID.test(uid)) throw notFound();
    const scope = await this.scope(ctx);
    if (input.guardianEmail !== undefined) {
      await this.guardian.changeEmail(ctx.workspaceId, scope, uid, input.guardianEmail);
    }
    const db = tenantDb(ctx.workspaceId);
    const m = await db.membership.findFirst({
      where: { AND: [{ userId: uid, role: 'STUDENT', status: { notIn: ENDED } }, scope] },
      include: { user: { select: USER_FIELDS } },
    });
    if (!m) throw notFound();
    const link = await db.guardianLink.findFirst({
      where: { studentUserId: uid },
      select: { studentUserId: true, guardianEmail: true, status: true, consentExpiresAt: true },
    });
    return toSummary(m, link ?? undefined, ctx);
  }

  /**
   * The caller's membership filter: scope `all` → none; a STUDENT (`own`) → himself; an
   * organisation TEACHER / ASSISTANT (`own`) → his assigned or invited students (`ownScope`).
   */
  private async scope(ctx: MemberCtx): Promise<Prisma.MembershipWhereInput> {
    if (ctx.scope === 'all') return {};
    if (RequestContext.get()?.membership?.role === 'STUDENT') return { userId: ctx.userId };
    return ownScope(ctx);
  }

  /**
   * A list cursor names a STUDENT of this workspace (any status): a position taken from another
   * workspace's listing → `422` on `cursor` (SP1.6 F8), like the members cursor.
   */
  private async cursorIn(ctx: MemberCtx, raw: string) {
    const cursor = decodeMemberCursor(raw);
    const row = await tenantDb(ctx.workspaceId).membership.findFirst({
      where: { userId: cursor[2], role: 'STUDENT' },
      select: { id: true },
    });
    if (!row) throw validationFailed('cursor', 'Unknown cursor');
    return cursor;
  }
}
