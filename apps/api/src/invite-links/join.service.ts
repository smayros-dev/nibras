import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  normaliseInviteCode,
  type AcceptJoinInput,
  type AcceptResult,
  type JoinPreview,
} from '@nibras/contracts';
import {
  crossTenantDb,
  Prisma,
  withTenantTx,
  type GuardedClient,
  type InviteLink,
  type MembershipStatus,
  type TenantTx,
  type User,
  type Workspace,
} from '@nibras/db';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/crypto/password';
import { PasswordPolicy } from '../auth/crypto/password-policy';
import { EmailVerificationService } from '../auth/email-verification.service';
import { toMeUser } from '../auth/me-user';
import { emailTaken, type RegistrationMeta } from '../auth/register.service';
import { SessionService } from '../auth/session.service';
import { requiresTwoFactor } from '../auth/two-factor.policy';
import { ApiError } from '../common/api-error';
import { uniqueViolationOn } from '../common/prisma-errors';
import type { AuthUser } from '../common/request-context';
import { TokenAttemptLimiter } from '../common/token-attempt-limiter';
import { DB } from '../db/db.module';
import {
  GuardianRequestService,
  type ArmedGuardianRequest,
} from '../guardian/guardian-request.service';
import {
  assertWorkspaceAcceptsMembers,
  assignTeacherInTx,
  createOrJoinInTx,
  hasActiveGuardianConsent,
  lockWorkspaceOpen,
  prepareStudentIdentity,
  type AcceptOutcome,
} from '../invitations/accept.service';
import { ConsentService } from '../me/consent.service';
import {
  INVITE_LINK_JOINED,
  InviteLinkJoinedEvent,
  MEMBERSHIP_ACTIVATED,
  MembershipActivatedEvent,
} from '../members/events';
import { MembershipService, type AddedMember } from '../members/membership.service';
import { validationFailed } from '../workspaces/workspaces.service';

type ResolvedWorkspace = Pick<
  Workspace,
  'id' | 'name' | 'type' | 'status' | 'defaultLocale' | 'defaultTimezone'
>;
type Person = Pick<User, 'id' | 'firstName' | 'lastName'>;
type ResolvedLink = InviteLink & { workspace: ResolvedWorkspace; createdBy: Person };

const WORKSPACE_FIELDS = {
  id: true,
  name: true,
  type: true,
  status: true,
  defaultLocale: true,
  defaultTimezone: true,
} as const;
const PERSON_FIELDS = { id: true, firstName: true, lastName: true } as const;

function notFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}

/**
 * `410` for a link that takes no more students: disabled first, then exhausted (stored, or the
 * counter at its limit), then expired.
 */
function assertLinkOpen(
  row: Pick<InviteLink, 'status' | 'usesCount' | 'maxUses' | 'expiresAt'>,
  now: Date,
): void {
  if (row.status === 'DISABLED') {
    throw new ApiError(HttpStatus.GONE, 'INVITE_LINK_DISABLED', 'This link was disabled');
  }
  if (row.status === 'EXHAUSTED' || row.usesCount >= row.maxUses) {
    throw new ApiError(HttpStatus.GONE, 'INVITE_LINK_EXHAUSTED', 'This link has no uses left');
  }
  if (row.status === 'EXPIRED' || (row.expiresAt !== null && row.expiresAt <= now)) {
    throw new ApiError(HttpStatus.GONE, 'INVITE_LINK_EXPIRED', 'This link has expired');
  }
}

/**
 * Public join by group code (PRD §8.3.3, D-P18 — a code is not bound to an address; design §4.3,
 * D2, D5). The code resolves its link through `crossTenantDb()` by the code only
 * (`CROSS_TENANT_LOOKUP_KEYS`); every write then runs in `withTenantTx(link.workspaceId)`.
 * Unknown and malformed codes are indistinguishable (`404 NOT_FOUND`) and count as failed attempts
 * per ip (`TokenAttemptLimiter`, scope `join`, checked before every lookup).
 */
@Injectable()
export class JoinService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'user'>,
    private readonly limiter: TokenAttemptLimiter,
    private readonly policy: PasswordPolicy,
    private readonly sessions: SessionService,
    private readonly verification: EmailVerificationService,
    private readonly membership: MembershipService,
    private readonly guardian: GuardianRequestService,
    private readonly consents: ConsentService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(JoinService.name);
  }

  /**
   * The open link of `rawCode` (trimmed, upper-cased): `429` past the failed-attempt limit;
   * unknown / malformed → `404 NOT_FOUND` (counted); disabled, exhausted, expired → `410
   * INVITE_LINK_*`.
   */
  async resolve(rawCode: string, ip: string): Promise<ResolvedLink> {
    await this.limiter.assertAllowed('join', ip);
    const code = normaliseInviteCode(rawCode);
    const row = code
      ? await crossTenantDb().inviteLink.findFirst({
          where: { code },
          include: {
            workspace: { select: WORKSPACE_FIELDS },
            createdBy: { select: PERSON_FIELDS },
          },
        })
      : null;
    if (!row) {
      await this.limiter.failed('join', ip);
      throw notFound();
    }
    assertLinkOpen(row, new Date());
    return row;
  }

  /** `GET /join/{code}`: what the public join page shows. */
  async preview(rawCode: string, viewer: AuthUser | undefined, ip: string): Promise<JoinPreview> {
    const link = await this.resolve(rawCode, ip);
    const teacher = await this.teacherOf(link);
    return {
      workspace: { id: link.workspace.id, name: link.workspace.name, type: link.workspace.type },
      teacher: { firstName: teacher.firstName, lastName: teacher.lastName },
      requiresApproval: link.requiresApproval,
      viewer: viewer ? 'SIGNED_IN' : 'ANONYMOUS',
      accountRequired: !viewer,
    };
  }

  /**
   * `POST /join/{code}/accept`. Order of the checks: the code (`404` / `410`), the workspace
   * (`423 WORKSPACE_SUSPENDED` unless ACTIVE), the mode (`REGISTER` signed in → `422` on `mode`;
   * `REGISTER` with an existing address → `409 EMAIL_TAKEN`; `JOIN` anonymous → `401`), the
   * student rules (`422 BIRTH_DATE_REQUIRED` / `GUARDIAN_EMAIL_REQUIRED` / `GUARDIAN_EMAIL_INVALID`)
   * and the password policy. Then ONE tenant transaction locks the link row and re-checks it (the
   * last use taken concurrently → `410 INVITE_LINK_EXHAUSTED`), re-checks the workspace, creates
   * the account **unverified** with an `EMAIL_VERIFY` token (`REGISTER`, D2) or records a missing
   * birth date (`JOIN`), adds the STUDENT membership (`409 ALREADY_MEMBER` rolls everything back)
   * as `PENDING_APPROVAL` when the link requires approval, else `PENDING_GUARDIAN_CONSENT` for a
   * minor without an active consent for this workspace (and arms the consent request), else
   * `ACTIVE`; counts the use (`EXHAUSTED` at `maxUses`) and assigns the link's teacher in an
   * organisation. With approval, a minor's guardian address is kept on a token-less `PENDING`
   * guardian link: the consent email goes out at approval (D5). After the commit: audits
   * `member.added` and `invite_link.used`, the guardian's email, the verification email, and
   * `MembershipActivatedEvent` for an `ACTIVE` member, and `InviteLinkJoinedEvent` whatever the
   * status (SP3: the link's `courseIds` become enrollments); `REGISTER` gets a session.
   */
  async accept(
    rawCode: string,
    body: AcceptJoinInput,
    viewer: AuthUser | undefined,
    meta: RegistrationMeta,
  ): Promise<AcceptOutcome> {
    const link = await this.resolve(rawCode, meta.ip);
    assertWorkspaceAcceptsMembers(link.workspace);
    let account: Pick<User, 'id' | 'email' | 'birthDate'> | null = null;
    if (body.mode === 'REGISTER') {
      if (viewer) throw validationFailed('mode', 'Already signed in: sign out first, or use JOIN');
      const existing = await this.db.user.findUnique({
        where: { email: body.email },
        select: { id: true },
      });
      if (existing) throw emailTaken();
    } else {
      if (!viewer) {
        throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Authentication required');
      }
      account = await this.db.user.findUniqueOrThrow({
        where: { id: viewer.id },
        select: { id: true, email: true, birthDate: true },
      });
    }
    const now = new Date();
    const student = prepareStudentIdentity({
      role: 'STUDENT',
      studentEmail: body.mode === 'REGISTER' ? body.email : account!.email,
      accountBirthDate: account?.birthDate,
      body,
      now,
    });

    let passwordHash: string | undefined;
    if (body.mode === 'REGISTER') {
      const check = await this.policy.validate(body.password);
      if (!check.ok) {
        throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, check.code, 'Password rejected');
      }
      passwordHash = await hashPassword(body.password);
    }

    let committed: {
      user: User;
      added: AddedMember;
      armed: ArmedGuardianRequest | undefined;
      teacherUserId: string | null;
      verifyToken: string | undefined;
    };
    try {
      committed = await withTenantTx(link.workspaceId, async (tx) => {
        const usesCount = await this.lockOpen(tx, link);
        await lockWorkspaceOpen(tx, link.workspaceId);
        const user = await createOrJoinInTx(
          tx,
          body.mode === 'REGISTER'
            ? {
                mode: 'REGISTER',
                account: {
                  email: body.email,
                  passwordHash: passwordHash!,
                  firstName: body.firstName,
                  lastName: body.lastName,
                  locale: body.locale,
                  timezone: body.timezone,
                  birthDate: student.birthDateToStore ?? body.birthDate,
                },
              }
            : { mode: 'JOIN', userId: account!.id, birthDateToStore: student.birthDateToStore },
          meta,
        );
        let verifyToken: string | undefined;
        if (body.mode === 'REGISTER') {
          const token = this.verification.newToken(user.id);
          await tx.verificationToken.create({ data: token.data });
          verifyToken = token.raw;
        }

        const needsConsent =
          student.minor && !(await hasActiveGuardianConsent(tx, link.workspaceId, user.id));
        const status: MembershipStatus = link.requiresApproval
          ? 'PENDING_APPROVAL'
          : needsConsent
            ? 'PENDING_GUARDIAN_CONSENT'
            : 'ACTIVE';
        const added = await this.membership.addMember(
          {
            workspaceId: link.workspaceId,
            userId: user.id,
            role: 'STUDENT',
            status,
            invitedByUserId: link.createdByUserId,
          },
          tx,
        );
        const used = usesCount + 1;
        await tx.inviteLink.update({
          where: { id: link.id },
          data: { usesCount: used, ...(used >= link.maxUses && { status: 'EXHAUSTED' }) },
        });
        const teacherUserId = await assignTeacherInTx(tx, {
          workspaceId: link.workspaceId,
          workspaceType: link.workspace.type,
          role: 'STUDENT',
          candidate: link.teacherUserId ?? link.createdByUserId,
          assignedByUserId: link.createdByUserId,
          studentUserId: user.id,
        });
        let armed: ArmedGuardianRequest | undefined;
        if (status === 'PENDING_GUARDIAN_CONSENT') {
          armed = await this.guardian.start(tx, {
            workspaceId: link.workspaceId,
            studentUserId: user.id,
            guardianEmail: student.guardianEmail!,
          });
        } else if (status === 'PENDING_APPROVAL' && needsConsent) {
          await keepGuardianAddress(tx, link.workspaceId, user.id, student.guardianEmail!);
        }
        return { user, added, armed, teacherUserId, verifyToken };
      });
    } catch (err) {
      if (uniqueViolationOn(err, 'email')) throw emailTaken();
      throw err;
    }

    const { user, added, armed, verifyToken } = committed;
    const membershipStatus = added.membership.status;
    await added.audit();
    await this.audit.log({
      action: 'invite_link.used',
      entityType: 'InviteLink',
      entityId: link.id,
      workspaceId: link.workspaceId,
      after: { linkId: link.id, userId: user.id, mode: body.mode, membershipStatus },
      actorOverride: { userId: user.id, role: 'USER' },
    });
    if (armed) {
      await this.guardian.notify({
        ...armed,
        student: user,
        workspace: link.workspace,
        teacher: await this.teacherOf(link, committed.teacherUserId),
      });
    }
    if (verifyToken) await this.verification.send(user, verifyToken);
    if (membershipStatus === 'ACTIVE') {
      this.publishActivated(new MembershipActivatedEvent(link.workspaceId, user.id));
    }
    this.publishJoined(new InviteLinkJoinedEvent(link.workspaceId, link.id, user.id));

    const session =
      body.mode === 'REGISTER'
        ? await this.sessions.createSession(user, { ...meta, remember: false })
        : undefined;
    const [twoFactorRequired, pendingConsents] = await Promise.all([
      requiresTwoFactor(user),
      this.consents.pending(user.id),
    ]);
    return {
      session,
      result: {
        user: toMeUser(user, { twoFactorRequired, pendingConsents }),
        workspace: {
          id: link.workspace.id,
          name: link.workspace.name,
          type: link.workspace.type,
        },
        membershipStatus,
        role: 'STUDENT',
      } satisfies AcceptResult,
    };
  }

  /**
   * `SELECT … FOR UPDATE` on the link, then the same `410` checks on the locked values: of two
   * concurrent joins on the last use, the second waits here and then sees the counter at its
   * limit. Returns the locked `usesCount`.
   */
  private async lockOpen(tx: TenantTx, link: ResolvedLink): Promise<number> {
    const rows = await tx.$queryRaw<
      {
        status: InviteLink['status'];
        uses_count: number;
        max_uses: number;
        expires_at: Date | null;
      }[]
    >(
      Prisma.sql`SELECT status::text AS status, uses_count, max_uses, expires_at FROM "invite_link"
        WHERE id = ${link.id}::uuid
        FOR UPDATE`,
    );
    const row = rows[0];
    if (!row) throw notFound();
    assertLinkOpen(
      {
        status: row.status,
        usesCount: row.uses_count,
        maxUses: row.max_uses,
        expiresAt: row.expires_at,
      },
      new Date(),
    );
    return row.uses_count;
  }

  /** The teacher the join page and the guardian email name: the link's teacher, else its creator. */
  private async teacherOf(
    link: ResolvedLink,
    teacherUserId: string | null = link.teacherUserId,
  ): Promise<Pick<User, 'firstName' | 'lastName'>> {
    if (!teacherUserId || teacherUserId === link.createdByUserId) return link.createdBy;
    const teacher = await this.db.user.findUnique({
      where: { id: teacherUserId },
      select: { firstName: true, lastName: true },
    });
    return teacher ?? link.createdBy;
  }

  /** Fire-and-forget: the join is committed, a listener's failure is only logged. */
  private publishActivated(event: MembershipActivatedEvent): void {
    const failed = (err: unknown) =>
      this.logger.error(
        {
          err: { type: err instanceof Error ? err.name : typeof err },
          workspaceId: event.workspaceId,
          userId: event.userId,
        },
        'MembershipActivatedEvent listener failed',
      );
    try {
      this.events.emitAsync(MEMBERSHIP_ACTIVATED, event).catch(failed);
    } catch (err) {
      failed(err);
    }
  }

  /** SP3: same for {@link InviteLinkJoinedEvent} (the enrollment hooks). */
  private publishJoined(event: InviteLinkJoinedEvent): void {
    const failed = (err: unknown) =>
      this.logger.error(
        {
          err: { type: err instanceof Error ? err.name : typeof err },
          workspaceId: event.workspaceId,
          inviteLinkId: event.inviteLinkId,
        },
        'InviteLinkJoinedEvent listener failed',
      );
    try {
      this.events.emitAsync(INVITE_LINK_JOINED, event).catch(failed);
    } catch (err) {
      failed(err);
    }
  }
}

/**
 * Code with approval and a minor (D5): the guardian address is kept on the (student, workspace)
 * guardian link as a token-less `PENDING` request — no consent link exists and no email is sent
 * until a teacher approves (`ApprovalService` arms it then). A previous cycle's token is retired.
 */
export async function keepGuardianAddress(
  tx: TenantTx,
  workspaceId: string,
  studentUserId: string,
  guardianEmail: string,
): Promise<void> {
  const dormant = {
    status: 'PENDING' as const,
    guardianEmail,
    consentTokenHash: null,
    consentExpiresAt: null,
    consentSentAt: null,
    decidedAt: null,
  };
  await tx.guardianLink.upsert({
    where: { studentUserId_workspaceId: { studentUserId, workspaceId } },
    create: { workspaceId, studentUserId, ...dormant },
    update: dormant,
  });
}
