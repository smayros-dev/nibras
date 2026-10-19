import { REDACT_KEYS } from '@nibras/contracts';
import type { Prisma, PrismaClient } from '@nibras/db';
import type { Logger } from 'pino';

/** The client a system audit row is written with (the worker's BYPASSRLS client). */
export type SystemAuditDb = Pick<PrismaClient, 'auditLog'>;

export interface SystemAuditEntry {
  workspaceId: string | null;
  /** One of the API's `AuditAction` values (e.g. `guardian.consent_expired`). */
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

/** Field names never stored in `before`/`after` (same rule as the API's `AuditService`). */
const SECRET_KEY = /hash|secret|password|token/i;
/** The shared log redaction keys, except `email`: tenant data the audit trail keeps. */
const REDACTED = new Set(REDACT_KEYS.filter((k) => k !== 'email').map((k) => k.toLowerCase()));

const isSecretKey = (key: string): boolean =>
  SECRET_KEY.test(key) || REDACTED.has(key.toLowerCase());

/** JSON-safe deep copy without secret keys (`bigint` → string, `Date` → ISO string). */
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

const toJson = (value: unknown): Prisma.InputJsonValue | undefined =>
  value === undefined ? undefined : (stripSecrets(value) as Prisma.InputJsonValue);

/**
 * Appends an `audit_log` row written by a job (`AuditService` lives in the API): no actor
 * (`actorUserId` null, `actorRole` `SYSTEM`), `requestId = job:{jobId}`, the secret keys stripped
 * at any depth. Never throws: a failed write is logged (`audit write failed`, identifiers only)
 * and the job goes on.
 */
export async function writeSystemAudit(
  db: SystemAuditDb,
  entry: SystemAuditEntry,
  jobId: string,
  logger: Pick<Logger, 'error'>,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        workspaceId: entry.workspaceId,
        actorUserId: null,
        actorRole: 'SYSTEM',
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        requestId: `job:${jobId}`,
      },
    });
  } catch (err) {
    logger.error(
      {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        workspace_id: entry.workspaceId,
        jobId,
        err: { type: err instanceof Error ? err.name : typeof err },
      },
      'audit write failed',
    );
  }
}
