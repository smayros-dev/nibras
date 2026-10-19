import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { isMinor, type MemberSummary } from '@nibras/contracts';
import {
  Prisma,
  withTenantTx,
  type GuardedClient,
  type Membership,
  type TenantTx,
  type User,
  type Workspace,
} from '@nibras/db';
import type { EmailProvider } from '@nibras/providers';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { env } from '../config/env';
import { DB } from '../db/db.module';
import {
  GuardianRequestService,
  type ArmedGuardianRequest,
} from '../guardian/guardian-request.service';
import { hasActiveGuardianConsent } from '../invitations/accept.service';
import {
  MEMBERSHIP_ACTIVATED,
  MEMBERSHIP_DEACTIVATED,
  MembershipActivatedEvent,
  MembershipDeactivatedEvent,
} from '../members/events';
import type { MemberCtx } from '../members/members.service';
import { EMAIL_PROVIDER } from '../providers/providers.module';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Student = Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'locale' | 'birthDate'>;
type MailWorkspace = Pick<Workspace, 'id' | 'name' | 'defaultLocale' | 'defaultTimezone'>;
type Person = Pick<User, 'firstName' | 'lastName'>;

const fullName = (p: Person): string => `${p.firstName} ${p.lastName}`.trim();

function notFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}

function notPending(): ApiError {
  return new ApiError(
    HttpStatus.CONFLICT,
    'MEMBERSHIP_NOT_PENDING',
    'This membership is not waiting for approval',
  );
}

function toSummary(m: Membership, user: Student, scope: MemberCtx['scope']): MemberSummary {
  return {
    userId: m.userId,
    firstName: user.firstName,
    lastName: user.lastName,
    ...(scope === 'all' && { email: user.email }),
    role: m.role,
    canTeach: m.canTeach,
    status: m.status,
    joinedAt: m.joinedAt?.toISOString() ?? null,
  };
}

/**
 * The approval queue of group codes (PRD §8.3.3, §10.4 `PENDING_APPROVAL → ACTIVE | REJECTED`;
 * design §4.3, D5). Only STUDENT memberships in `PENDING_APPROVAL` are decided here (else `409
 * MEMBERSHIP_NOT_PENDING`); scope `own` (organisation TEACHER): only the students whose
 * `invitedByUserId` is the caller (the creator of the link they used) — anyone else is `404`, like
 * a uid of another workspace. Each decision runs in one tenant transaction under the membership's
 * row lock (two concurrent decisions: the second sees `409`).
 */
@Injectable()
export class ApprovalService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'workspace' | 'user'>,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly guardian: GuardianRequestService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(ApprovalService.name);
  }

  /**
   * `POST /workspaces/{wid}/members/{uid}/approve`. A minor (by his account's birth date, or
   * recorded as one when he joined: a token-less `PENDING` guardian link) without an active
   * consent for this workspace becomes `PENDING_GUARDIAN_CONSENT` and his guardian is asked
   * **now** (D5) — `422 GUARDIAN_EMAIL_REQUIRED` when no guardian address is on record; anyone
   * else becomes `ACTIVE` (`joinedAt`). After the commit: audit `member.approved`, the guardian's
   * consent email, `join.approved` to the student, `MembershipActivatedEvent` when `ACTIVE`.
   */
  async approve(ctx: MemberCtx, uid: string): Promise<MemberSummary> {
    const now = new Date();
    const { membership, student, armed } = await withTenantTx(ctx.workspaceId, async (tx) => {
      const current = await this.lockPending(tx, ctx, uid);
      const student = await this.student(uid);
      const link = await tx.guardianLink.findFirst({ where: { studentUserId: uid } });
      const minorByAccount =
        student.birthDate !== null && isMinor(student.birthDate.toISOString().slice(0, 10), now);
      const minor = minorByAccount || link?.status === 'PENDING';
      let armed: ArmedGuardianRequest | undefined;
      if (minor && !(await hasActiveGuardianConsent(tx, ctx.workspaceId, uid))) {
        if (!link) {
          throw new ApiError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'GUARDIAN_EMAIL_REQUIRED',
            "No guardian's email is on record for this minor",
          );
        }
        armed = await this.guardian.start(tx, {
          workspaceId: ctx.workspaceId,
          studentUserId: uid,
          guardianEmail: link.guardianEmail,
        });
      }
      const status = armed ? 'PENDING_GUARDIAN_CONSENT' : 'ACTIVE';
      const { count } = await tx.membership.updateMany({
        where: { id: current.id, status: 'PENDING_APPROVAL' },
        data: { status, ...(status === 'ACTIVE' && { joinedAt: now }) },
      });
      if (count !== 1) throw notPending();
      const membership = await tx.membership.findFirstOrThrow({ where: { id: current.id } });
      return { membership, student, armed };
    });

    await this.audit.log({
      action: 'member.approved',
      entityType: 'Membership',
      entityId: membership.id,
      before: { status: 'PENDING_APPROVAL' },
      after: { userId: uid, status: membership.status },
    });
    const workspace = await this.workspace(ctx.workspaceId);
    const teacher = await this.teacherOf(membership, ctx.userId);
    if (armed) {
      await this.guardian.notify({ ...armed, student, workspace, teacher });
    }
    await this.sendDecision('join.approved', student, workspace, teacher);
    if (membership.status === 'ACTIVE') {
      this.publish(MEMBERSHIP_ACTIVATED, new MembershipActivatedEvent(ctx.workspaceId, uid));
    }
    return toSummary(membership, student, ctx.scope);
  }

  /**
   * `POST /workspaces/{wid}/members/{uid}/reject`: `REJECTED` with `removedAt` and
   * `removalReason: 'REJECTED'` (the user may be invited again later). After the commit: audit
   * `member.rejected`, `join.rejected` to the student, `MembershipDeactivatedEvent`.
   */
  async reject(ctx: MemberCtx, uid: string): Promise<MemberSummary> {
    const now = new Date();
    const membership = await withTenantTx(ctx.workspaceId, async (tx) => {
      const current = await this.lockPending(tx, ctx, uid);
      const { count } = await tx.membership.updateMany({
        where: { id: current.id, status: 'PENDING_APPROVAL' },
        data: { status: 'REJECTED', removedAt: now, removalReason: 'REJECTED' },
      });
      if (count !== 1) throw notPending();
      return tx.membership.findFirstOrThrow({ where: { id: current.id } });
    });
    const student = await this.student(uid);
    await this.audit.log({
      action: 'member.rejected',
      entityType: 'Membership',
      entityId: membership.id,
      before: { status: 'PENDING_APPROVAL' },
      after: { userId: uid, status: 'REJECTED', removalReason: 'REJECTED' },
    });
    const workspace = await this.workspace(ctx.workspaceId);
    await this.sendDecision(
      'join.rejected',
      student,
      workspace,
      await this.teacherOf(membership, ctx.userId),
    );
    this.publish(
      MEMBERSHIP_DEACTIVATED,
      new MembershipDeactivatedEvent(ctx.workspaceId, uid, 'REJECTED', 'REJECTED'),
    );
    return toSummary(membership, student, ctx.scope);
  }

  /**
   * The STUDENT membership of `uid` in the route's workspace, visible to the caller, locked
   * (`FOR UPDATE`) and still `PENDING_APPROVAL`; else `404` (unknown, other workspace, not a
   * student, outside scope `own`) or `409 MEMBERSHIP_NOT_PENDING`.
   */
  private async lockPending(tx: TenantTx, ctx: MemberCtx, uid: string): Promise<Membership> {
    if (!UUID.test(uid)) throw notFound();
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "membership" WHERE user_id = ${uid}::uuid FOR UPDATE`,
    );
    const current = await tx.membership.findFirst({ where: { userId: uid, role: 'STUDENT' } });
    if (!current) throw notFound();
    if (ctx.scope === 'own' && current.invitedByUserId !== ctx.userId) throw notFound();
    if (current.status !== 'PENDING_APPROVAL') throw notPending();
    return current;
  }

  private student(uid: string): Promise<Student> {
    return this.db.user.findUniqueOrThrow({
      where: { id: uid },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        locale: true,
        birthDate: true,
      },
    });
  }

  private workspace(wid: string): Promise<MailWorkspace> {
    return this.db.workspace.findUniqueOrThrow({
      where: { id: wid },
      select: { id: true, name: true, defaultLocale: true, defaultTimezone: true },
    });
  }

  /** The teacher the emails name: the student's inviter (the link's creator), else the caller. */
  private async teacherOf(m: Membership, callerId: string): Promise<Person> {
    return this.db.user.findUniqueOrThrow({
      where: { id: m.invitedByUserId ?? callerId },
      select: { firstName: true, lastName: true },
    });
  }

  /**
   * `join.approved` / `join.rejected` to the student in his locale (an approved student is sent to
   * the workspace, a rejected one to his home page). A delivery failure is logged with identifiers
   * only and swallowed: the decision is committed.
   */
  private async sendDecision(
    templateKey: 'join.approved' | 'join.rejected',
    student: Student,
    workspace: MailWorkspace,
    teacher: Person,
  ): Promise<void> {
    const origin = env.WEB_ORIGIN.replace(/\/+$/, '');
    const link =
      templateKey === 'join.approved'
        ? `${origin}/${student.locale}/app/w/${workspace.id}`
        : `${origin}/${student.locale}/app`;
    try {
      await this.email.send({
        to: student.email,
        templateKey,
        locale: student.locale,
        params: {
          firstName: student.firstName,
          workspaceName: workspace.name,
          teacherName: fullName(teacher),
          link,
        },
      });
    } catch (err) {
      this.logger.error(
        {
          userId: student.id,
          workspaceId: workspace.id,
          err: { type: err instanceof Error ? err.name : typeof err },
        },
        'join decision email not sent',
      );
    }
  }

  /** Fire-and-forget: the decision is committed, a listener's failure is only logged. */
  private publish(
    name: string,
    event: MembershipActivatedEvent | MembershipDeactivatedEvent,
  ): void {
    const failed = (err: unknown) =>
      this.logger.error(
        {
          err: { type: err instanceof Error ? err.name : typeof err },
          workspaceId: event.workspaceId,
          userId: event.userId,
        },
        'membership event listener failed',
      );
    try {
      this.events.emitAsync(name, event).catch(failed);
    } catch (err) {
      failed(err);
    }
  }
}
