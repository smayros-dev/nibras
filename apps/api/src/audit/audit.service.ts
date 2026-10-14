import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { REDACT_KEYS } from '@tt/contracts';
import { CROSS_TENANT_AUDIT_ACTION, Prisma, type GuardedClient } from '@tt/db';
import { PinoLogger } from 'nestjs-pino';
import { RequestContext, type RequestStore } from '../common/request-context';
import { DB } from '../db/db.module';
import { auditWriteFailures } from '../observability/metrics';

/** Every audited action of SP1 (PRD §8.16.3); later sub-projects append theirs. */
export type AuditAction =
  | 'auth.registered'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.account_locked'
  | 'auth.refresh_reuse_detected'
  | 'auth.sessions_revoked'
  | 'auth.password_changed'
  | 'auth.password_change_failed'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'auth.password_reset_failed'
  | 'auth.email_change_requested'
  | 'auth.email_change_failed'
  | 'auth.email_changed'
  | 'auth.2fa_enabled'
  | 'auth.2fa_disabled'
  | 'auth.recovery_code_used'
  | 'auth.forbidden_workspace'
  | 'user.profile_updated'
  | 'user.suspended'
  | 'user.unsuspended'
  | 'user.super_admin_granted'
  | 'phone.verified'
  | 'consent.granted'
  | 'consent.revoked'
  | 'workspace.created'
  | 'workspace.updated'
  | 'workspace.settings_updated'
  | 'workspace.ownership_transferred'
  | 'workspace.suspended'
  | 'workspace.unsuspended'
  | 'workspace.deleted'
  | 'workspace.quota_changed'
  | 'member.added'
  | 'member.removed'
  | 'member.role_changed'
  | 'assignment.created'
  | 'assignment.deleted'
  | 'abuse_report.created'
  | 'abuse_report.updated'
  | typeof CROSS_TENANT_AUDIT_ACTION;

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  /** Defaults to the request's workspace. */
  workspaceId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Actor when the context has none or another one applies (failed login, jobs). */
  actorOverride?: { userId?: string; role: string };
}

/** Field names that are never stored in `before`/`after`: hashes, secrets, credentials. */
const SECRET_KEY = /hash|secret|password|token/i;
/**
 * The shared log redaction keys (OTP and recovery codes, credentials, cookies) apply too, except
 * `email`: it is redacted from logs as PII, but an email change is exactly what the audit records.
 */
const REDACTED = new Set(REDACT_KEYS.filter((k) => k !== 'email').map((k) => k.toLowerCase()));

function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key) || REDACTED.has(key.toLowerCase());
}

/**
 * JSON-safe deep copy of `value` without secret keys (objects and arrays, any depth): `bigint`
 * (e.g. storage quotas) becomes a decimal string, which JSON cannot otherwise carry, and a `Date`
 * an ISO string.
 */
function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSecretKey(key))
      .map(([key, v]) => [key, stripSecrets(v)]),
  );
}

function toJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (stripSecrets(value) as Prisma.InputJsonValue);
}

/**
 * The actor's role: the membership role when acting in the entry's workspace, else the platform
 * role (`SUPER_ADMIN`) or `USER`; `ANONYMOUS` for an unauthenticated request and `SYSTEM` outside
 * any request (jobs, boot).
 */
function actorRoleOf(store: RequestStore | undefined, workspaceId: string | undefined): string {
  if (!store) return 'SYSTEM';
  const { user, workspace, membership } = store;
  if (membership && workspace && workspace.id === workspaceId) return membership.role;
  if (!user) return 'ANONYMOUS';
  return user.platformRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'USER';
}

/**
 * Append-only audit trail (`audit_log`, AC-GDPR-05). Writes through `db` (the `app_user` role,
 * which may only INSERT/SELECT that table). Never throws: a failed write is logged at error level
 * and the caller's operation goes on.
 */
@Injectable()
export class AuditService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'auditLog'>,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(AuditService.name);
  }

  async log(entry: AuditEntry): Promise<void> {
    const store = RequestContext.get();
    const workspaceId = entry.workspaceId ?? store?.workspace?.id;
    try {
      await this.db.auditLog.create({
        data: {
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          workspaceId: workspaceId ?? null,
          actorUserId: entry.actorOverride
            ? (entry.actorOverride.userId ?? null)
            : (store?.user?.id ?? null),
          actorRole: entry.actorOverride?.role ?? actorRoleOf(store, workspaceId),
          before: toJson(entry.before),
          after: toJson(entry.after),
          // `inet` rejects '' (no address known).
          ip: store?.ip || null,
          userAgent: store?.userAgent || null,
          requestId: store?.requestId ?? `system-${randomUUID()}`,
        },
      });
    } catch (err) {
      auditWriteFailures.inc({ action: entry.action });
      // Only identifiers: before/after may hold personal data, and a Prisma validation error's
      // message prints the query arguments, so only its name is kept.
      const safeErr = err instanceof Prisma.PrismaClientValidationError ? { type: err.name } : err;
      this.logger.error(
        {
          err: safeErr,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
        },
        'audit log write failed',
      );
    }
  }
}
