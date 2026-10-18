import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OWNER_SUSPENDED_REASON } from '@nibras/contracts';
import type { GuardedClient, User } from '@nibras/db';
import type { EmailMessage, EmailProvider } from '@nibras/providers';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { ApiError } from '../common/api-error';
import type { AuthUser } from '../common/request-context';
import { DB } from '../db/db.module';
import { EMAIL_PROVIDER } from '../providers/providers.module';
import { adminActor, notFound } from './admin.service';
import { USER_SUSPENDED, UserSuspendedEvent } from './events';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Target = Pick<
  User,
  'id' | 'email' | 'firstName' | 'locale' | 'status' | 'platformRole' | 'suspendedReason'
>;
type SuspensionEmail =
  EmailMessage<'admin.user_suspended'> | EmailMessage<'admin.user_unsuspended'>;

/**
 * Suspension of a user account by the super-admin (PRD §8.1.6, §8.16.4, AC-SAFE-04 — SP1 part).
 * A suspended user is refused everywhere at once: every session is revoked (the access JWT dies
 * on its next request, `JwtAuthGuard` reads the session each time), login answers `403
 * ACCOUNT_SUSPENDED`, and his PERSONAL workspaces turn read-only (`SUSPENDED`,
 * `OWNER_SUSPENDED`). Organisations he owns are left alone (their members keep working; an admin
 * may suspend them separately). Both directions are idempotent: a repeat changes nothing and
 * sends, audits and emits nothing.
 */
@Injectable()
export class UserSuspensionService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'user' | '$transaction'>,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly events: EventEmitter2,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(UserSuspensionService.name);
  }

  /**
   * Unknown, DELETING or DELETED user → `404`; a SUPER_ADMIN (the caller included) → `409
   * CANNOT_SUSPEND_SUPER_ADMIN`. In one transaction: the user `SUSPENDED` with `reason`, and
   * every ACTIVE PERSONAL workspace he owns `SUSPENDED` / `OWNER_SUSPENDED` (one already
   * suspended keeps its own reason). Then: all his sessions revoked, audits `user.suspended` and
   * `workspace.suspended` per workspace, email `admin.user_suspended`, `UserSuspendedEvent`.
   */
  async suspend(actor: AuthUser, userId: string, reason: string): Promise<void> {
    const target = await this.find(userId);
    if (target.platformRole === 'SUPER_ADMIN') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'CANNOT_SUSPEND_SUPER_ADMIN',
        'A super-admin cannot be suspended',
      );
    }
    if (target.status !== 'ACTIVE') return;

    const suspendedAt = new Date();
    const workspaceIds = await this.db.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: target.id, status: 'ACTIVE', platformRole: { not: 'SUPER_ADMIN' } },
        data: { status: 'SUSPENDED', suspendedReason: reason, suspendedAt },
      });
      // Suspended (or changed) concurrently: that request does the rest.
      if (count !== 1) return null;
      const owned = await tx.workspace.findMany({
        where: { ownerUserId: target.id, type: 'PERSONAL', status: 'ACTIVE' },
        select: { id: true },
      });
      const ids = owned.map((w) => w.id);
      if (ids.length > 0) {
        await tx.workspace.updateMany({
          where: { id: { in: ids }, status: 'ACTIVE' },
          data: { status: 'SUSPENDED', suspendedReason: OWNER_SUSPENDED_REASON, suspendedAt },
        });
      }
      return ids;
    });
    if (workspaceIds === null) return;

    const revokedSessions = await this.sessions.revokeAll(target.id);
    await this.audit.log({
      action: 'user.suspended',
      entityType: 'User',
      entityId: target.id,
      actorOverride: adminActor(actor),
      before: { status: 'ACTIVE' },
      after: {
        status: 'SUSPENDED',
        suspendedReason: reason,
        suspendedAt,
        revokedSessions,
        suspendedWorkspaceIds: workspaceIds,
      },
    });
    for (const id of workspaceIds) {
      await this.audit.log({
        action: 'workspace.suspended',
        entityType: 'Workspace',
        entityId: id,
        workspaceId: id,
        actorOverride: adminActor(actor),
        before: { status: 'ACTIVE', suspendedReason: null },
        after: { status: 'SUSPENDED', suspendedReason: OWNER_SUSPENDED_REASON, suspendedAt },
      });
    }
    await this.send(target, {
      to: target.email,
      locale: target.locale,
      templateKey: 'admin.user_suspended',
      params: { firstName: target.firstName, reason },
    });
    this.publishSuspended(new UserSuspendedEvent(target.id, reason));
  }

  /**
   * Unknown, DELETING or DELETED user → `404`; already ACTIVE → no-op. In one transaction: the
   * user `ACTIVE` (reason and date cleared) and every workspace he owns that is `SUSPENDED` with
   * `OWNER_SUSPENDED` back to `ACTIVE` (a workspace suspended for another reason stays so).
   * Audits `user.unsuspended` and `workspace.unsuspended` per workspace; email
   * `admin.user_unsuspended`. Cancelled sessions are not restored (AC-SAFE-04).
   */
  async unsuspend(actor: AuthUser, userId: string): Promise<void> {
    const target = await this.find(userId);
    if (target.status !== 'SUSPENDED') return;

    const workspaceIds = await this.db.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: target.id, status: 'SUSPENDED' },
        data: { status: 'ACTIVE', suspendedReason: null, suspendedAt: null },
      });
      if (count !== 1) return null;
      const owned = await tx.workspace.findMany({
        where: {
          ownerUserId: target.id,
          status: 'SUSPENDED',
          suspendedReason: OWNER_SUSPENDED_REASON,
        },
        select: { id: true },
      });
      const ids = owned.map((w) => w.id);
      if (ids.length > 0) {
        await tx.workspace.updateMany({
          where: { id: { in: ids }, status: 'SUSPENDED', suspendedReason: OWNER_SUSPENDED_REASON },
          data: { status: 'ACTIVE', suspendedReason: null, suspendedAt: null },
        });
      }
      return ids;
    });
    if (workspaceIds === null) return;

    await this.audit.log({
      action: 'user.unsuspended',
      entityType: 'User',
      entityId: target.id,
      actorOverride: adminActor(actor),
      before: { status: 'SUSPENDED', suspendedReason: target.suspendedReason },
      after: { status: 'ACTIVE', reactivatedWorkspaceIds: workspaceIds },
    });
    for (const id of workspaceIds) {
      await this.audit.log({
        action: 'workspace.unsuspended',
        entityType: 'Workspace',
        entityId: id,
        workspaceId: id,
        actorOverride: adminActor(actor),
        before: { status: 'SUSPENDED', suspendedReason: OWNER_SUSPENDED_REASON },
        after: { status: 'ACTIVE' },
      });
    }
    await this.send(target, {
      to: target.email,
      locale: target.locale,
      templateKey: 'admin.user_unsuspended',
      params: { firstName: target.firstName },
    });
  }

  private async find(userId: string): Promise<Target> {
    if (!UUID.test(userId)) throw notFound();
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        locale: true,
        status: true,
        platformRole: true,
        suspendedReason: true,
      },
    });
    if (!user || user.status === 'DELETING' || user.status === 'DELETED') throw notFound();
    return user;
  }

  /** Best effort: the change is committed, a failed email is logged (ids only). */
  private async send(to: Pick<User, 'id'>, mail: SuspensionEmail): Promise<void> {
    try {
      await this.email.send(mail);
    } catch (err) {
      this.logger.error(
        {
          userId: to.id,
          templateKey: mail.templateKey,
          err: { type: err instanceof Error ? err.name : typeof err },
        },
        'suspension email not sent',
      );
    }
  }

  /** Fire-and-forget: the suspension is committed, a listener's failure is only logged. */
  private publishSuspended(event: UserSuspendedEvent): void {
    const failed = (err: unknown) =>
      this.logger.error(
        { err: { type: err instanceof Error ? err.name : typeof err }, userId: event.userId },
        'UserSuspendedEvent listener failed',
      );
    try {
      this.events.emitAsync(USER_SUSPENDED, event).catch(failed);
    } catch (err) {
      failed(err);
    }
  }
}
