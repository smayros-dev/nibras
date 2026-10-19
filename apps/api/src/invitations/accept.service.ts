import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  hashOpaqueToken,
  isMinor,
  maskEmail,
  OPAQUE_TOKEN_RAW_LENGTH,
  type AcceptInvitationInput,
  type AcceptResult,
  type InvitationPreview,
} from '@nibras/contracts';
import {
  crossTenantDb,
  Prisma,
  withTenantTx,
  type GuardedClient,
  type Invitation,
  type MembershipRole,
  type MembershipStatus,
  type TenantTx,
  type User,
  type Workspace,
} from '@nibras/db';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/crypto/password';
import { PasswordPolicy } from '../auth/crypto/password-policy';
import { toMeUser } from '../auth/me-user';
import {
  createAccountInTx,
  emailTaken,
  type NewAccount,
  type RegistrationMeta,
} from '../auth/register.service';
import { SessionService, type SessionTokens } from '../auth/session.service';
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
import { ConsentService } from '../me/consent.service';
import { INVITATION_ACCEPTED, InvitationAcceptedEvent } from '../members/events';
import { MembershipService, type AddedMember } from '../members/membership.service';
import { validationFailed } from '../workspaces/workspaces.service';
import { InvitationMailerService } from './invitation-mailer.service';

/** A raw opaque token as the links carry it (base64url of 32 bytes). */
const TOKEN_SHAPE = new RegExp(`^[A-Za-z0-9_-]{${OPAQUE_TOKEN_RAW_LENGTH}}$`);

type ResolvedWorkspace = Pick<
  Workspace,
  'id' | 'name' | 'type' | 'status' | 'defaultLocale' | 'defaultTimezone'
>;
type Inviter = Pick<User, 'id' | 'firstName' | 'lastName' | 'email' | 'locale'>;
type ResolvedInvitation = Invitation & { workspace: ResolvedWorkspace; invitedBy: Inviter };

const WORKSPACE_FIELDS = {
  id: true,
  name: true,
  type: true,
  status: true,
  defaultLocale: true,
  defaultTimezone: true,
} as const;
const INVITER_FIELDS = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  locale: true,
} as const;

/** The result handed to the controller: the body, plus the session to set on `REGISTER`. */
export interface AcceptOutcome {
  result: AcceptResult;
  session?: SessionTokens;
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

function tokenInvalid(): ApiError {
  return new ApiError(HttpStatus.GONE, 'TOKEN_INVALID', 'This link is invalid');
}

/** `410` for an invitation that can no longer be accepted (status first, then the expiry). */
function assertOpen(row: Pick<Invitation, 'status' | 'expiresAt'>, now: Date): void {
  if (row.status === 'REVOKED') {
    throw new ApiError(HttpStatus.GONE, 'INVITATION_REVOKED', 'This invitation was revoked');
  }
  if (row.status === 'ACCEPTED') {
    throw new ApiError(
      HttpStatus.GONE,
      'INVITATION_ALREADY_ACCEPTED',
      'This invitation was already accepted',
    );
  }
  if (row.status === 'EXPIRED' || row.expiresAt <= now) {
    throw new ApiError(HttpStatus.GONE, 'INVITATION_EXPIRED', 'This invitation has expired');
  }
}

/** The signed-in user against the invited address (citext: case-insensitive). */
function viewerOf(
  invitation: Pick<Invitation, 'email'>,
  viewer: Pick<AuthUser, 'email'> | undefined,
): InvitationPreview['viewer'] {
  if (!viewer) return 'ANONYMOUS';
  return viewer.email.toLowerCase() === invitation.email.toLowerCase() ? 'MATCH' : 'MISMATCH';
}

const unprocessable = (code: 'BIRTH_DATE_REQUIRED' | 'GUARDIAN_EMAIL_REQUIRED', msg: string) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, code, msg);

/** What the student rules (§8.1.1, D-P3) decided before the transaction. */
export interface StudentDecision {
  minor: boolean;
  guardianEmail: string | null;
  /** Written on the account when it has no birth date yet. */
  birthDateToStore: string | undefined;
}

/** The facts the student rules weigh: the account, a preset (invitation) and the request body. */
export interface StudentIdentityInput {
  role: MembershipRole;
  /** The student's address (the invited one, the registering one or the signed-in one). */
  studentEmail: string;
  /** The existing account's birth date (`JOIN`), if any. */
  accountBirthDate: Date | null | undefined;
  /** The invitation's birth date (email invitations only). */
  presetBirthDate?: Date | null;
  presetGuardianEmail?: string | null;
  body: { birthDate?: string; guardianEmail?: string };
  now: Date;
}

/**
 * STUDENT rules shared by the invitation acceptance and the join by code (§8.1.1, D-P3): a birth
 * date is required (body, account or preset — else `422 BIRTH_DATE_REQUIRED`). The account's
 * stored date wins over the preset (which applies only when the account has none); a body date is
 * taken into account too, and any applicable minor date makes the student a minor (a body can
 * never turn a known minor into an adult). A minor needs a guardian email (body, else preset —
 * else `422 GUARDIAN_EMAIL_REQUIRED`) different from his own address (`422
 * GUARDIAN_EMAIL_INVALID`). The youngest applicable date is the one recorded on an account that
 * has none (conservative under a conflict). Other roles only record a body date on an account
 * without one.
 */
export function prepareStudentIdentity(input: StudentIdentityInput): StudentDecision {
  const { body } = input;
  const accountDate = input.accountBirthDate ? ymd(input.accountBirthDate) : undefined;
  if (input.role !== 'STUDENT') {
    return {
      minor: false,
      guardianEmail: null,
      birthDateToStore: accountDate ? undefined : body.birthDate,
    };
  }
  const base = accountDate ?? (input.presetBirthDate ? ymd(input.presetBirthDate) : undefined);
  const dates = [body.birthDate, base].filter((d): d is string => d !== undefined);
  if (dates.length === 0) {
    throw unprocessable('BIRTH_DATE_REQUIRED', 'A birth date is required');
  }
  const minor = dates.some((d) => isMinor(d, input.now));
  const birthDateToStore = accountDate ? undefined : dates.reduce((a, b) => (a > b ? a : b));
  if (!minor) return { minor, guardianEmail: null, birthDateToStore };
  const guardianEmail = body.guardianEmail ?? input.presetGuardianEmail;
  if (!guardianEmail) {
    throw unprocessable('GUARDIAN_EMAIL_REQUIRED', "A minor needs a guardian's email");
  }
  if (guardianEmail.toLowerCase() === input.studentEmail.toLowerCase()) {
    throw new ApiError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'GUARDIAN_EMAIL_INVALID',
      "The guardian's email must differ from the student's",
    );
  }
  return { minor, guardianEmail: guardianEmail.toLowerCase(), birthDateToStore };
}

/** How a public acceptance path obtains the student's account inside its transaction. */
export type CreateOrJoin =
  | { mode: 'REGISTER'; account: NewAccount }
  | { mode: 'JOIN'; userId: string; birthDateToStore?: string };

/**
 * `REGISTER` → `createAccountInTx` (user + TERMS/PRIVACY consents); `JOIN` → the signed-in
 * account, with `birthDateToStore` written only while it has no birth date. Runs in the caller's
 * `withTenantTx`; a duplicate address surfaces as the `P2002` on `email`.
 */
export async function createOrJoinInTx(
  tx: TenantTx,
  input: CreateOrJoin,
  meta: RegistrationMeta,
): Promise<User> {
  if (input.mode === 'REGISTER') return createAccountInTx(tx, input.account, meta);
  if (input.birthDateToStore) {
    await tx.user.updateMany({
      where: { id: input.userId, birthDate: null },
      data: { birthDate: new Date(`${input.birthDateToStore}T00:00:00.000Z`) },
    });
  }
  return tx.user.findUniqueOrThrow({ where: { id: input.userId } });
}

/**
 * `423 WORKSPACE_SUSPENDED` (`details.status`) unless the workspace is `ACTIVE`: a SUSPENDED or
 * DELETING workspace takes no new member through a public link (the code its tenant routes
 * answer to mutations, AC-WS-06; the suspension reason stays internal on these public routes).
 */
export function assertWorkspaceAcceptsMembers(workspace: Pick<Workspace, 'status'>): void {
  if (workspace.status !== 'ACTIVE') {
    throw new ApiError(423, 'WORKSPACE_SUSPENDED', 'Workspace is suspended', {
      status: workspace.status,
    });
  }
}

/** The same check inside the acceptance transaction (a suspension committed in between). */
export async function lockWorkspaceOpen(tx: TenantTx, workspaceId: string): Promise<void> {
  const workspace = await tx.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { status: true },
  });
  assertWorkspaceAcceptsMembers(workspace);
}

/** An `ACTIVE` guardian link with an unrevoked `GUARDIAN_PARENTAL` consent for this workspace. */
export async function hasActiveGuardianConsent(
  tx: TenantTx,
  wid: string,
  userId: string,
): Promise<boolean> {
  const link = await tx.guardianLink.findFirst({
    where: { studentUserId: userId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!link) return false;
  const consents = await tx.consent.count({
    where: {
      userId,
      workspaceId: wid,
      type: 'GUARDIAN_PARENTAL',
      granted: true,
      revokedAt: null,
    },
  });
  return consents > 0;
}

/**
 * Organisation STUDENT: assigned to `candidate` provided that person is still an ACTIVE teaching
 * member (`TEACHER`, or `ADMIN`/`OWNER` with `canTeach`); otherwise no assignment. (A PERSONAL
 * workspace's assignment to its owner is `addMember`'s.) Returns the assigned teacher, if any.
 */
export async function assignTeacherInTx(
  tx: TenantTx,
  input: {
    workspaceId: string;
    workspaceType: Workspace['type'];
    role: MembershipRole;
    candidate: string;
    assignedByUserId: string;
    studentUserId: string;
  },
): Promise<string | null> {
  if (input.workspaceType !== 'ORGANIZATION' || input.role !== 'STUDENT') return null;
  const member = await tx.membership.findFirst({
    where: { userId: input.candidate, status: 'ACTIVE' },
    select: { role: true, canTeach: true },
  });
  const teaches =
    member !== null &&
    (member.role === 'TEACHER' ||
      ((member.role === 'ADMIN' || member.role === 'OWNER') && member.canTeach));
  if (!teaches) return null;
  await tx.teacherStudentAssignment.createMany({
    data: [
      {
        workspaceId: input.workspaceId,
        teacherUserId: input.candidate,
        studentUserId: input.studentUserId,
        assignedByUserId: input.assignedByUserId,
      },
    ],
    skipDuplicates: true,
  });
  return input.candidate;
}

/**
 * Public acceptance of an email invitation (PRD §8.1.1 « J'ai une invitation », §8.3.2, D-P18;
 * design §4.2). The token resolves its invitation through `crossTenantDb()` by its hash only
 * (`CROSS_TENANT_LOOKUP_KEYS`); every write then runs in `withTenantTx(invitation.workspaceId)`.
 * Unknown, malformed and replaced tokens are indistinguishable (`410 TOKEN_INVALID`) and count as
 * failed attempts per ip (`TokenAttemptLimiter`, checked before every lookup).
 */
@Injectable()
export class AcceptService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'user'>,
    private readonly limiter: TokenAttemptLimiter,
    private readonly policy: PasswordPolicy,
    private readonly sessions: SessionService,
    private readonly membership: MembershipService,
    private readonly guardian: GuardianRequestService,
    private readonly mailer: InvitationMailerService,
    private readonly consents: ConsentService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(AcceptService.name);
  }

  /**
   * The invitation of `token`: `429` past the failed-attempt limit; unknown / malformed /
   * replaced → `410 TOKEN_INVALID` (counted); revoked, accepted, expired → `410 INVITATION_*`.
   */
  async resolve(token: string, ip: string): Promise<ResolvedInvitation> {
    await this.limiter.assertAllowed('invite', ip);
    const row = TOKEN_SHAPE.test(token)
      ? await crossTenantDb().invitation.findFirst({
          where: { tokenHash: hashOpaqueToken(token) },
          include: {
            workspace: { select: WORKSPACE_FIELDS },
            invitedBy: { select: INVITER_FIELDS },
          },
        })
      : null;
    if (!row) {
      await this.limiter.failed('invite', ip);
      throw tokenInvalid();
    }
    assertOpen(row, new Date());
    return row;
  }

  /** `GET /invitations/{token}`: what the public invitation page shows (address masked). */
  async preview(
    token: string,
    viewer: AuthUser | undefined,
    ip: string,
  ): Promise<InvitationPreview> {
    const invitation = await this.resolve(token, ip);
    const account = await this.db.user.findUnique({
      where: { email: invitation.email },
      select: { birthDate: true },
    });
    return {
      workspace: {
        id: invitation.workspace.id,
        name: invitation.workspace.name,
        type: invitation.workspace.type,
      },
      inviter: {
        firstName: invitation.invitedBy.firstName,
        lastName: invitation.invitedBy.lastName,
      },
      role: invitation.role as InvitationPreview['role'],
      emailMasked: maskEmail(invitation.email),
      accountExists: account !== null,
      viewer: viewerOf(invitation, viewer),
      requiresBirthDate:
        invitation.role === 'STUDENT' && !(invitation.birthDate ?? account?.birthDate),
      guardianEmailPrefilled: invitation.guardianEmail !== null,
      expiresAt: invitation.expiresAt.toISOString(),
      message: invitation.message,
    };
  }

  /**
   * `POST /invitations/{token}/accept`. Order of the checks: the token (`410`), the address
   * binding (`403 INVITATION_EMAIL_MISMATCH`), the mode (`REGISTER` signed in → `422` on `mode`;
   * `REGISTER` with an existing account → `409 EMAIL_TAKEN`; `JOIN` anonymous → `401`), the
   * student rules (`422 BIRTH_DATE_REQUIRED` / `GUARDIAN_EMAIL_REQUIRED` / `GUARDIAN_EMAIL_INVALID`)
   * and the password policy (`422 PASSWORD_*`). Then ONE tenant transaction locks the invitation
   * row and re-checks it (a concurrent acceptance → `410 INVITATION_ALREADY_ACCEPTED`), creates the
   * account (`REGISTER`: email verified, design D2) or records a missing birth date (`JOIN`), adds
   * the membership (`PENDING_GUARDIAN_CONSENT` for a minor without an active consent for this
   * workspace, else `ACTIVE`), assigns the organisation's teacher, arms the guardian consent request
   * and marks the invitation `ACCEPTED`. After the commit: audits, the guardian's and the inviter's
   * emails, `InvitationAcceptedEvent`, and on `REGISTER` a new session. A TEACHER / ADMIN never
   * gets a PERSONAL workspace here (D-O7).
   */
  async accept(
    token: string,
    body: AcceptInvitationInput,
    viewer: AuthUser | undefined,
    meta: RegistrationMeta,
  ): Promise<AcceptOutcome> {
    const invitation = await this.resolve(token, meta.ip);
    assertWorkspaceAcceptsMembers(invitation.workspace);
    if (viewerOf(invitation, viewer) === 'MISMATCH') {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'INVITATION_EMAIL_MISMATCH',
        'This invitation is meant for another address',
        { emailMasked: maskEmail(invitation.email) },
      );
    }
    let account: Pick<User, 'id' | 'birthDate'> | null = null;
    if (body.mode === 'REGISTER') {
      if (viewer) throw validationFailed('mode', 'Already signed in: sign out first, or use JOIN');
      const existing = await this.db.user.findUnique({
        where: { email: invitation.email },
        select: { id: true },
      });
      if (existing) throw emailTaken();
    } else {
      if (!viewer) {
        throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Authentication required');
      }
      account = await this.db.user.findUniqueOrThrow({
        where: { id: viewer.id },
        select: { id: true, birthDate: true },
      });
    }
    const now = new Date();
    const student = prepareStudentIdentity({
      role: invitation.role,
      studentEmail: invitation.email,
      accountBirthDate: account?.birthDate,
      presetBirthDate: invitation.birthDate,
      presetGuardianEmail: invitation.guardianEmail,
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
    };
    try {
      committed = await withTenantTx(invitation.workspaceId, async (tx) => {
        await this.lockOpen(tx, invitation);
        await lockWorkspaceOpen(tx, invitation.workspaceId);
        const user = await createOrJoinInTx(
          tx,
          body.mode === 'REGISTER'
            ? {
                mode: 'REGISTER',
                account: {
                  email: invitation.email,
                  passwordHash: passwordHash!,
                  firstName: body.firstName,
                  lastName: body.lastName,
                  locale: body.locale,
                  timezone: body.timezone,
                  birthDate: student.birthDateToStore ?? body.birthDate,
                  emailVerifiedAt: now,
                },
              }
            : { mode: 'JOIN', userId: account!.id, birthDateToStore: student.birthDateToStore },
          meta,
        );

        const status: MembershipStatus =
          student.minor && !(await hasActiveGuardianConsent(tx, invitation.workspaceId, user.id))
            ? 'PENDING_GUARDIAN_CONSENT'
            : 'ACTIVE';
        const added = await this.membership.addMember(
          {
            workspaceId: invitation.workspaceId,
            userId: user.id,
            role: invitation.role,
            status,
            invitedByUserId: invitation.invitedByUserId,
            // An explicit email invitation brings a rejected student back (SP2 T7 decision).
            reactivateRejected: true,
          },
          tx,
        );
        const teacherUserId = await assignTeacherInTx(tx, {
          workspaceId: invitation.workspaceId,
          workspaceType: invitation.workspace.type,
          role: invitation.role,
          candidate: invitation.teacherUserId ?? invitation.invitedByUserId,
          assignedByUserId: invitation.invitedByUserId,
          studentUserId: user.id,
        });
        const armed =
          status === 'PENDING_GUARDIAN_CONSENT'
            ? await this.guardian.start(tx, {
                workspaceId: invitation.workspaceId,
                studentUserId: user.id,
                guardianEmail: student.guardianEmail!,
              })
            : undefined;
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { status: 'ACCEPTED', acceptedByUserId: user.id, acceptedAt: now },
        });
        return { user, added, armed, teacherUserId };
      });
    } catch (err) {
      if (uniqueViolationOn(err, 'email')) throw emailTaken();
      throw err;
    }

    const { user, added, armed } = committed;
    const membershipStatus = added.membership.status;
    await added.audit();
    await this.audit.log({
      action: 'invitation.accepted',
      entityType: 'Invitation',
      entityId: invitation.id,
      workspaceId: invitation.workspaceId,
      after: { userId: user.id, mode: body.mode, role: invitation.role, membershipStatus },
      actorOverride: { userId: user.id, role: 'USER' },
    });
    if (armed) {
      await this.guardian.notify({
        ...armed,
        student: user,
        workspace: invitation.workspace,
        teacher: await this.teacherName(invitation, committed.teacherUserId),
      });
    }
    await this.mailer.sendAccepted(invitation, user, invitation.invitedBy, invitation.workspace);
    this.publishAccepted(
      new InvitationAcceptedEvent(invitation.workspaceId, invitation.id, user.id, invitation.role),
    );

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
          id: invitation.workspace.id,
          name: invitation.workspace.name,
          type: invitation.workspace.type,
        },
        membershipStatus,
        role: invitation.role,
      },
    };
  }

  /**
   * `SELECT … FOR UPDATE` on the invitation, still carrying this token's hash: a concurrent
   * acceptance waits here and then sees `ACCEPTED`; a resend in between replaced the hash
   * (`410 TOKEN_INVALID`).
   */
  private async lockOpen(tx: TenantTx, invitation: ResolvedInvitation): Promise<void> {
    const rows = await tx.$queryRaw<{ status: Invitation['status']; expires_at: Date }[]>(
      Prisma.sql`SELECT status::text AS status, expires_at FROM "invitation"
        WHERE id = ${invitation.id}::uuid AND token_hash = ${invitation.tokenHash}
        FOR UPDATE`,
    );
    const row = rows[0];
    if (!row) throw tokenInvalid();
    assertOpen({ status: row.status, expiresAt: row.expires_at }, new Date());
  }

  /** The teacher the guardian email names: the assigned teacher, else the inviter. */
  private async teacherName(
    invitation: ResolvedInvitation,
    teacherUserId: string | null,
  ): Promise<Pick<User, 'firstName' | 'lastName'>> {
    if (!teacherUserId || teacherUserId === invitation.invitedByUserId) return invitation.invitedBy;
    const teacher = await this.db.user.findUnique({
      where: { id: teacherUserId },
      select: { firstName: true, lastName: true },
    });
    return teacher ?? invitation.invitedBy;
  }

  /**
   * Fire-and-forget: the acceptance is committed, so a listener's failure (sync throw or
   * rejection) is logged and never reaches the HTTP response.
   */
  private publishAccepted(event: InvitationAcceptedEvent): void {
    const failed = (err: unknown) =>
      this.logger.error(
        {
          err: { type: err instanceof Error ? err.name : typeof err },
          invitationId: event.invitationId,
        },
        'InvitationAcceptedEvent listener failed',
      );
    try {
      this.events.emitAsync(INVITATION_ACCEPTED, event).catch(failed);
    } catch (err) {
      failed(err);
    }
  }
}
