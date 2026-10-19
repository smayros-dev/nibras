import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  generateOpaqueToken,
  GUARDIAN_CONSENT_VERSION,
  guardianPageLink,
  hashOpaqueToken,
  maskEmail,
  OPAQUE_TOKEN_RAW_LENGTH,
  type GuardianConsentPreview,
  type GuardianDecisionInput,
  type GuardianDecisionResult,
  type GuardianInfo,
  type GuardianRegrantInput,
  type GuardianRegrantResult,
  type GuardianView,
} from '@nibras/contracts';
import {
  crossTenantDb,
  Prisma,
  tenantDb,
  withTenantTx,
  type GuardedClient,
  type GuardianLink,
  type Membership,
  type MembershipStatus,
  type TenantTx,
  type Workspace,
} from '@nibras/db';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { RequestContext, type AuthUser } from '../common/request-context';
import { TokenAttemptLimiter } from '../common/token-attempt-limiter';
import { env } from '../config/env';
import { DB } from '../db/db.module';
import { assertWorkspaceAcceptsMembers, lockWorkspaceOpen } from '../invitations/accept.service';
import {
  MEMBERSHIP_ACTIVATED,
  MEMBERSHIP_DEACTIVATED,
  MembershipActivatedEvent,
  MembershipDeactivatedEvent,
} from '../members/events';
import type { MemberCtx } from '../members/members.service';
import { GuardianMailerService, type GuardianMailUser } from './guardian-mailer.service';
import { GuardianRequestService } from './guardian-request.service';

/** A raw opaque token as the links carry it (base64url of 32 bytes). */
const TOKEN_SHAPE = new RegExp(`^[A-Za-z0-9_-]{${OPAQUE_TOKEN_RAW_LENGTH}}$`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The membership statuses a guardian decision (or a consent resend) applies to (D-O5). */
const CONSENT_WAITING: MembershipStatus[] = [
  'PENDING_GUARDIAN_CONSENT',
  'SUSPENDED_NO_CONSENT',
  'SUSPENDED_CONSENT_REVOKED',
];
const ENDED: MembershipStatus[] = ['REMOVED', 'REJECTED'];

/** The guardian has no account: his audit rows carry this role and no actor id. */
const GUARDIAN_ACTOR = { role: 'GUARDIAN' } as const;

/** The request's address and user-agent (`RequestIdMiddleware`). */
export interface GuardianRequestMeta {
  ip: string;
  userAgent: string;
}

type ContextWorkspace = Pick<
  Workspace,
  'id' | 'name' | 'type' | 'status' | 'defaultLocale' | 'defaultTimezone' | 'ownerUserId'
>;

/** A guardian link with the people and the workspace its pages and emails name. */
interface LinkContext {
  workspace: ContextWorkspace;
  student: GuardianMailUser;
  teacher: GuardianMailUser;
}

const USER_FIELDS = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  locale: true,
} as const;
const WORKSPACE_FIELDS = {
  id: true,
  name: true,
  type: true,
  status: true,
  defaultLocale: true,
  defaultTimezone: true,
  ownerUserId: true,
} as const;

/** Which secret column a public token is matched against. */
type TokenKind = 'consent' | 'page';
const TOKEN_COLUMN: Record<TokenKind, string> = {
  consent: 'consent_token_hash',
  page: 'sessions_view_token_hash',
};

function tokenInvalid(): ApiError {
  return new ApiError(HttpStatus.GONE, 'TOKEN_INVALID', 'This link is invalid');
}

function linkInactive(): ApiError {
  return new ApiError(
    HttpStatus.CONFLICT,
    'GUARDIAN_LINK_INACTIVE',
    'This consent cannot be changed in its current state',
  );
}

function notFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}

function notPending(): ApiError {
  return new ApiError(
    HttpStatus.CONFLICT,
    'MEMBERSHIP_NOT_PENDING',
    'This membership is not waiting for a guardian consent',
  );
}

/**
 * `410` unless the consent request is still open: decided (status or `decidedAt`) →
 * `CONSENT_ALREADY_DECIDED` (in practice a decision clears the token, so `TOKEN_INVALID` answers
 * first; this covers a race), past `consentExpiresAt` → `CONSENT_LINK_EXPIRED`.
 */
function assertConsentable(
  link: Pick<GuardianLink, 'status' | 'decidedAt' | 'consentExpiresAt'>,
  now: Date,
): void {
  if (link.status !== 'PENDING' || link.decidedAt !== null) {
    throw new ApiError(
      HttpStatus.GONE,
      'CONSENT_ALREADY_DECIDED',
      'This consent request was already answered',
    );
  }
  if (!link.consentExpiresAt || link.consentExpiresAt <= now) {
    throw new ApiError(HttpStatus.GONE, 'CONSENT_LINK_EXPIRED', 'This consent link has expired');
  }
}

/** The guardian of a student membership as the student (`/me/workspaces`) or staff see it. */
export function guardianInfo(
  link: Pick<GuardianLink, 'guardianEmail' | 'status' | 'consentExpiresAt'>,
): GuardianInfo {
  return {
    emailMasked: maskEmail(link.guardianEmail),
    status: link.status,
    consentExpiresAt: link.consentExpiresAt?.toISOString() ?? null,
  };
}

/** The request's address and user-agent (`RequestIdMiddleware`). */
export function guardianRequestMeta(): GuardianRequestMeta {
  const store = RequestContext.get();
  return { ip: store?.ip ?? '', userAgent: store?.userAgent ?? '' };
}

/**
 * The guardian side of D-O5 (PRD §8.3.5, §11.2 `GuardianLink`; design §4.4): the public consent
 * page (`/guardian-consent/{token}`, 14-day single-use token), the long-lived guardian page
 * (`/guardian/{token}`: view, revoke, re-grant — one bearer token, replaced at every re-grant,
 * D6) and the consent resends of the teacher and of the student.
 *
 * Public tokens resolve their link through `crossTenantDb()` by the hash of one secret column
 * only (`CROSS_TENANT_LOOKUP_KEYS`); every write then runs in `withTenantTx(link.workspaceId)`
 * under the link's row lock, so a token never reaches another workspace's rows (AC-SAFE-06,
 * Review Focus 4). Unknown, malformed and replaced tokens are indistinguishable (`410
 * TOKEN_INVALID`) and count as failed attempts per ip (`TokenAttemptLimiter`, scope
 * `guardian`). A grant or re-grant into a SUSPENDED / DELETING workspace is refused (`423
 * WORKSPACE_SUSPENDED`); a refusal or a revocation never is (withdrawing consent must always
 * work). Nothing is ever purged (D-O5): a revocation or refusal suspends that workspace's
 * membership only.
 */
@Injectable()
export class GuardianService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'workspace' | 'user'>,
    private readonly limiter: TokenAttemptLimiter,
    private readonly request: GuardianRequestService,
    private readonly mailer: GuardianMailerService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(GuardianService.name);
  }

  /** `GET /guardian-consent/{token}`: what the consent page shows (no guardian email, no birth date). */
  async previewConsent(token: string, ip: string): Promise<GuardianConsentPreview> {
    const link = await this.resolve('consent', token, ip);
    assertConsentable(link, new Date());
    const { workspace, student, teacher } = await this.context(link);
    return {
      student: { firstName: student.firstName, lastName: student.lastName },
      workspace: { name: workspace.name, type: workspace.type },
      teacher: { firstName: teacher.firstName, lastName: teacher.lastName },
      expiresAt: link.consentExpiresAt!.toISOString(),
      version: GUARDIAN_CONSENT_VERSION,
      noticeUrl: `${env.WEB_ORIGIN.replace(/\/+$/, '')}/${workspace.defaultLocale}/legal/minors`,
      state: 'PENDING',
    };
  }

  /**
   * `POST /guardian-consent/{token}` (AC-INV-10). `GRANT`: a `GUARDIAN_PARENTAL` consent (ip,
   * user-agent, version, guardian email, workspace), the link `ACTIVE` with the guardian's names
   * and relationship, the consent token cleared (single use), a new guardian page token, the
   * membership `ACTIVE` when it waits on the consent (a membership `REMOVED` / `REJECTED`
   * meanwhile is left alone, Review Focus 2). `REFUSE`: the link `REFUSED` (no consent row, D4),
   * the token cleared, a `PENDING_GUARDIAN_CONSENT` membership → `SUSPENDED_NO_CONSENT`. After
   * the commit: audit, emails, membership event.
   */
  async decide(
    token: string,
    body: GuardianDecisionInput,
    meta: GuardianRequestMeta,
  ): Promise<GuardianDecisionResult> {
    const link = await this.resolve('consent', token, meta.ip);
    assertConsentable(link, new Date());
    const ctx = await this.context(link);

    if (body.decision === 'REFUSE') {
      const deactivated = await withTenantTx(link.workspaceId, async (tx) => {
        const locked = await this.lock(tx, link, 'consent');
        assertConsentable(locked, new Date());
        await tx.guardianLink.update({
          where: { id: link.id },
          data: {
            status: 'REFUSED',
            decidedAt: new Date(),
            consentTokenHash: null,
            guardianFirstName: body.guardianFirstName,
            guardianLastName: body.guardianLastName,
            relationship: body.relationship,
          },
        });
        const { count } = await tx.membership.updateMany({
          where: { userId: link.studentUserId, status: 'PENDING_GUARDIAN_CONSENT' },
          data: { status: 'SUSPENDED_NO_CONSENT' },
        });
        return count === 1;
      });
      await this.audit.log({
        action: 'guardian.consent_refused',
        entityType: 'GuardianLink',
        entityId: link.id,
        workspaceId: link.workspaceId,
        after: {
          studentUserId: link.studentUserId,
          relationship: body.relationship,
          membershipStatus: deactivated ? 'SUSPENDED_NO_CONSENT' : null,
        },
        actorOverride: GUARDIAN_ACTOR,
      });
      await this.mailer.sendDecision('guardian.consent_refused', { link, ...ctx }, [ctx.teacher]);
      if (deactivated) {
        this.publish(
          MEMBERSHIP_DEACTIVATED,
          new MembershipDeactivatedEvent(
            link.workspaceId,
            link.studentUserId,
            'SUSPENDED_NO_CONSENT',
            'CONSENT_REFUSED',
          ),
        );
      }
      return { decision: 'REFUSE' };
    }

    assertWorkspaceAcceptsMembers(ctx.workspace);
    const page = generateOpaqueToken();
    const granted = await withTenantTx(link.workspaceId, async (tx) => {
      const locked = await this.lock(tx, link, 'consent');
      assertConsentable(locked, new Date());
      await lockWorkspaceOpen(tx, link.workspaceId);
      return this.grantInTx(tx, locked, body, meta, page.hash);
    });
    await this.afterGrant(link, ctx, body, granted, page.raw, false);
    return {
      decision: 'GRANT',
      guardianPageUrl: guardianPageLink(env.WEB_ORIGIN, ctx.workspace.defaultLocale, page.raw),
    };
  }

  /**
   * `GET /guardian/{token}`: one (student, workspace) link — the student, that workspace, the
   * teacher and the link's state. `sessions` is empty until SP5, which fills it with that
   * workspace's sessions of that student only (AC-SAFE-06): a page token never shows another
   * workspace, even one where the same guardian consented.
   */
  async view(token: string, ip: string): Promise<GuardianView> {
    const link = await this.resolve('page', token, ip);
    const { workspace, student, teacher } = await this.context(link);
    const consent =
      link.consentId && (link.status === 'ACTIVE' || link.status === 'REVOKED')
        ? await tenantDb(link.workspaceId).consent.findFirst({
            where: { id: link.consentId },
            select: { grantedAt: true },
          })
        : null;
    return {
      student: { firstName: student.firstName, lastName: student.lastName },
      workspace: { id: workspace.id, name: workspace.name, type: workspace.type },
      teacher: { firstName: teacher.firstName, lastName: teacher.lastName },
      link: {
        status: link.status,
        grantedAt: consent?.grantedAt.toISOString() ?? null,
        revokedAt: link.status === 'REVOKED' ? (link.revokedAt?.toISOString() ?? null) : null,
        relationship: link.relationship,
      },
      sessions: [],
    };
  }

  /**
   * `POST /guardian/{token}/revoke` (AC-INV-11): an `ACTIVE` link only (else `409
   * GUARDIAN_LINK_INACTIVE`). In one tenant transaction: this workspace's unrevoked
   * `GUARDIAN_PARENTAL` consent revoked, the link `REVOKED` (`revokedAt`; `consentId` kept as the
   * history pointer, the page token kept for a re-grant), an `ACTIVE` membership →
   * `SUSPENDED_CONSENT_REVOKED`. Other workspaces, the account and the history are untouched.
   * After the commit: audit, emails to the student, his teacher and (organisation) every ACTIVE
   * OWNER / ADMIN, `MembershipDeactivatedEvent`.
   */
  async revoke(token: string, meta: GuardianRequestMeta): Promise<void> {
    const link = await this.resolve('page', token, meta.ip);
    if (link.status !== 'ACTIVE') throw linkInactive();
    const ctx = await this.context(link);
    const deactivated = await withTenantTx(link.workspaceId, async (tx) => {
      const locked = await this.lock(tx, link, 'page');
      if (locked.status !== 'ACTIVE') throw linkInactive();
      const now = new Date();
      await tx.consent.updateMany({
        where: { userId: link.studentUserId, type: 'GUARDIAN_PARENTAL', revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.guardianLink.update({
        where: { id: link.id },
        data: { status: 'REVOKED', revokedAt: now },
      });
      const { count } = await tx.membership.updateMany({
        where: { userId: link.studentUserId, status: 'ACTIVE' },
        data: { status: 'SUSPENDED_CONSENT_REVOKED' },
      });
      return count === 1;
    });
    await this.audit.log({
      action: 'guardian.consent_revoked',
      entityType: 'GuardianLink',
      entityId: link.id,
      workspaceId: link.workspaceId,
      before: { status: 'ACTIVE' },
      after: {
        studentUserId: link.studentUserId,
        consentId: link.consentId,
        membershipStatus: deactivated ? 'SUSPENDED_CONSENT_REVOKED' : null,
      },
      actorOverride: GUARDIAN_ACTOR,
    });
    await this.mailer.sendDecision(
      'guardian.consent_revoked',
      { link, ...ctx },
      await this.staffToNotify(link, ctx),
    );
    if (deactivated) {
      this.publish(
        MEMBERSHIP_DEACTIVATED,
        new MembershipDeactivatedEvent(
          link.workspaceId,
          link.studentUserId,
          'SUSPENDED_CONSENT_REVOKED',
          'CONSENT_REVOKED',
        ),
      );
    }
  }

  /**
   * `POST /guardian/{token}/grant`: a re-grant after a revocation or a refusal (`REVOKED` /
   * `REFUSED`, else `409 GUARDIAN_LINK_INACTIVE`) — the same writes as a `GRANT` with a new
   * `Consent` row and a **new** page token (the one used here answers `410 TOKEN_INVALID` from
   * now on).
   */
  async regrant(
    token: string,
    body: GuardianRegrantInput,
    meta: GuardianRequestMeta,
  ): Promise<GuardianRegrantResult> {
    const link = await this.resolve('page', token, meta.ip);
    const regrantable = (l: Pick<GuardianLink, 'status'>) =>
      l.status === 'REVOKED' || l.status === 'REFUSED';
    if (!regrantable(link)) throw linkInactive();
    const ctx = await this.context(link);
    assertWorkspaceAcceptsMembers(ctx.workspace);
    const page = generateOpaqueToken();
    const granted = await withTenantTx(link.workspaceId, async (tx) => {
      const locked = await this.lock(tx, link, 'page');
      if (!regrantable(locked)) throw linkInactive();
      await lockWorkspaceOpen(tx, link.workspaceId);
      return this.grantInTx(tx, locked, body, meta, page.hash);
    });
    await this.afterGrant(link, ctx, body, granted, page.raw, true);
    return {
      guardianPageUrl: guardianPageLink(env.WEB_ORIGIN, ctx.workspace.defaultLocale, page.raw),
    };
  }

  /**
   * `POST /workspaces/{wid}/students/{uid}/guardian/resend-consent` (`student.update`, verified
   * teacher): scope `own` (organisation TEACHER) → only his students (assigned or invited by
   * him); a STUDENT's `own` is himself. Anyone else, or a uid of another workspace → `404`.
   */
  async resendForStudent(ctx: MemberCtx, uid: string): Promise<GuardianInfo> {
    if (!UUID.test(uid)) throw notFound();
    const scope = await this.studentScope(ctx);
    return this.resend(ctx.workspaceId, uid, (tx) =>
      tx.membership.findFirst({ where: { AND: [{ userId: uid, role: 'STUDENT' }, scope] } }),
    );
  }

  /**
   * `POST /me/workspaces/{wid}/guardian/resend-consent`: the student's own resend while his
   * membership waits on the consent. Not a `/workspaces/:wid` route (D12: the workspace guard
   * refuses an inactive membership): the membership is found through `crossTenantDb()` filtered
   * by the caller's `userId`; no STUDENT membership there (or an ended one) → `404`.
   */
  async resendForSelf(user: Pick<AuthUser, 'id'>, wid: string): Promise<GuardianInfo> {
    if (!UUID.test(wid)) throw notFound();
    const membership = await crossTenantDb().membership.findFirst({
      where: { userId: user.id, workspaceId: wid },
      select: { role: true, status: true },
    });
    if (!membership || membership.role !== 'STUDENT' || ENDED.includes(membership.status)) {
      throw notFound();
    }
    return this.resend(wid, user.id, (tx) =>
      tx.membership.findFirst({ where: { userId: user.id, role: 'STUDENT' } }),
    );
  }

  /**
   * The shared resend: `423` for a SUSPENDED / DELETING workspace; the membership must wait on
   * the consent (`PENDING_GUARDIAN_CONSENT`, `SUSPENDED_NO_CONSENT`, `SUSPENDED_CONSENT_REVOKED`,
   * else `409 MEMBERSHIP_NOT_PENDING`); `GuardianRequestService.resend` arms a new 14-day
   * request (`429` within 10 minutes of the last send; the link → `PENDING`, the membership
   * unchanged until the guardian decides). After the commit: audit + email to the guardian.
   */
  private async resend(
    wid: string,
    uid: string,
    find: (tx: TenantTx) => Promise<Membership | null>,
  ): Promise<GuardianInfo> {
    const armed = await withTenantTx(wid, async (tx) => {
      await lockWorkspaceOpen(tx, wid);
      const membership = await find(tx);
      if (!membership) throw notFound();
      if (!CONSENT_WAITING.includes(membership.status)) throw notPending();
      const link = await tx.guardianLink.findFirst({ where: { studentUserId: uid } });
      if (!link) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'GUARDIAN_EMAIL_REQUIRED',
          "No guardian's email is on record for this student",
        );
      }
      return this.request.resend(tx, link);
    });
    const { workspace, student, teacher } = await this.context(armed.link);
    await this.request.notify({ ...armed, student, workspace, teacher });
    return guardianInfo(armed.link);
  }

  /** `own` scope on the students of `ctx.workspaceId` (see {@link resendForStudent}). */
  private async studentScope(ctx: MemberCtx): Promise<Prisma.MembershipWhereInput> {
    if (ctx.scope === 'all') return {};
    if (RequestContext.get()?.membership?.role === 'STUDENT') return { userId: ctx.userId };
    const assigned = await tenantDb(ctx.workspaceId).teacherStudentAssignment.findMany({
      where: { teacherUserId: ctx.userId },
      select: { studentUserId: true },
    });
    return {
      OR: [
        { userId: { in: assigned.map((a) => a.studentUserId) } },
        { invitedByUserId: ctx.userId },
      ],
    };
  }

  /**
   * The link of a public token: `429` past the failed-attempt limit; unknown / malformed /
   * replaced → `410 TOKEN_INVALID` (counted).
   */
  private async resolve(kind: TokenKind, token: string, ip: string): Promise<GuardianLink> {
    await this.limiter.assertAllowed('guardian', ip);
    let link: GuardianLink | null = null;
    if (TOKEN_SHAPE.test(token)) {
      const hash = hashOpaqueToken(token);
      link = await crossTenantDb().guardianLink.findFirst({
        where: kind === 'consent' ? { consentTokenHash: hash } : { sessionsViewTokenHash: hash },
      });
    }
    if (!link) {
      await this.limiter.failed('guardian', ip);
      throw tokenInvalid();
    }
    return link;
  }

  /**
   * `SELECT … FOR UPDATE` on the link, still carrying the token's hash (a resend or a re-grant
   * in between replaced it → `410 TOKEN_INVALID`); returns the locked row.
   */
  private async lock(tx: TenantTx, link: GuardianLink, kind: TokenKind): Promise<GuardianLink> {
    const hash = kind === 'consent' ? link.consentTokenHash : link.sessionsViewTokenHash;
    const rows = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM "guardian_link"
        WHERE id = ${link.id}::uuid AND ${Prisma.raw(TOKEN_COLUMN[kind])} = ${hash}
        FOR UPDATE`,
    );
    if (rows.length === 0) throw tokenInvalid();
    return tx.guardianLink.findFirstOrThrow({ where: { id: link.id } });
  }

  /** The grant's writes (see {@link decide}); `pageHash` becomes the guardian page token. */
  private async grantInTx(
    tx: TenantTx,
    link: GuardianLink,
    identity: Pick<GuardianRegrantInput, 'guardianFirstName' | 'guardianLastName' | 'relationship'>,
    meta: GuardianRequestMeta,
    pageHash: string,
  ): Promise<{ consentId: string; activated: boolean; membershipStatus: MembershipStatus | null }> {
    const now = new Date();
    const consent = await tx.consent.create({
      data: {
        userId: link.studentUserId,
        grantedByEmail: link.guardianEmail,
        type: 'GUARDIAN_PARENTAL',
        version: GUARDIAN_CONSENT_VERSION,
        granted: true,
        grantedAt: now,
        ip: meta.ip,
        userAgent: meta.userAgent,
        workspaceId: link.workspaceId,
      },
    });
    await tx.guardianLink.update({
      where: { id: link.id },
      data: {
        status: 'ACTIVE',
        guardianFirstName: identity.guardianFirstName,
        guardianLastName: identity.guardianLastName,
        relationship: identity.relationship,
        consentId: consent.id,
        decidedAt: now,
        revokedAt: null,
        consentTokenHash: null,
        sessionsViewTokenHash: pageHash,
      },
    });
    const membership = await tx.membership.findFirst({
      where: { userId: link.studentUserId },
      select: { id: true, status: true, joinedAt: true },
    });
    if (!membership || !CONSENT_WAITING.includes(membership.status)) {
      return {
        consentId: consent.id,
        activated: false,
        membershipStatus: membership?.status ?? null,
      };
    }
    const { count } = await tx.membership.updateMany({
      where: { id: membership.id, status: { in: CONSENT_WAITING } },
      data: { status: 'ACTIVE', joinedAt: membership.joinedAt ?? now },
    });
    return {
      consentId: consent.id,
      activated: count === 1,
      membershipStatus: count === 1 ? 'ACTIVE' : membership.status,
    };
  }

  /** After a grant or re-grant commit: audit, emails, `MembershipActivatedEvent`. */
  private async afterGrant(
    link: GuardianLink,
    ctx: LinkContext,
    identity: Pick<GuardianRegrantInput, 'relationship'>,
    granted: { consentId: string; activated: boolean; membershipStatus: MembershipStatus | null },
    pageRaw: string,
    regrant: boolean,
  ): Promise<void> {
    await this.audit.log({
      action: 'guardian.consent_granted',
      entityType: 'GuardianLink',
      entityId: link.id,
      workspaceId: link.workspaceId,
      before: { status: link.status },
      after: {
        studentUserId: link.studentUserId,
        relationship: identity.relationship,
        version: GUARDIAN_CONSENT_VERSION,
        consentId: granted.consentId,
        membershipStatus: granted.membershipStatus,
        regrant,
      },
      actorOverride: GUARDIAN_ACTOR,
    });
    await this.mailer.sendGranted({ link, ...ctx }, pageRaw, granted.activated);
    if (granted.activated) {
      this.publish(
        MEMBERSHIP_ACTIVATED,
        new MembershipActivatedEvent(link.workspaceId, link.studentUserId),
      );
    }
  }

  /**
   * The workspace, the student and the teacher of a link: the teacher is the student's inviter
   * (`invitedByUserId`), else the workspace owner.
   */
  private async context(
    link: Pick<GuardianLink, 'workspaceId' | 'studentUserId'>,
  ): Promise<LinkContext> {
    const workspace = await this.db.workspace.findUniqueOrThrow({
      where: { id: link.workspaceId },
      select: WORKSPACE_FIELDS,
    });
    const membership = await tenantDb(link.workspaceId).membership.findFirst({
      where: { userId: link.studentUserId },
      select: { invitedByUserId: true },
    });
    const [student, teacher] = await Promise.all([
      this.db.user.findUniqueOrThrow({ where: { id: link.studentUserId }, select: USER_FIELDS }),
      this.db.user.findUniqueOrThrow({
        where: { id: membership?.invitedByUserId ?? workspace.ownerUserId },
        select: USER_FIELDS,
      }),
    ]);
    return { workspace, student, teacher };
  }

  /**
   * Staff told of a revocation: the teacher, plus (organisation) every ACTIVE OWNER / ADMIN —
   * one email per person, never the student himself.
   */
  private async staffToNotify(
    link: Pick<GuardianLink, 'workspaceId' | 'studentUserId'>,
    ctx: LinkContext,
  ): Promise<GuardianMailUser[]> {
    const staff = new Map<string, GuardianMailUser>([[ctx.teacher.id, ctx.teacher]]);
    if (ctx.workspace.type === 'ORGANIZATION') {
      const managers = await tenantDb(link.workspaceId).membership.findMany({
        where: { status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
        select: { user: { select: USER_FIELDS } },
        orderBy: { userId: 'asc' },
      });
      for (const { user } of managers) staff.set(user.id, user);
    }
    staff.delete(link.studentUserId);
    return [...staff.values()];
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
