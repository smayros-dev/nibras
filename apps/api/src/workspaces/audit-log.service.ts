import { Inject, Injectable } from '@nestjs/common';
import type { AuditEntry, AuditLogPage, AuditLogQuery } from '@nibras/contracts';
import type { AuditLog, GuardedClient, Prisma } from '@nibras/db';
import { DB } from '../db/db.module';
import { validationFailed } from './workspaces.service';

function toEntry(row: AuditLog): AuditEntry {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    before: row.before ?? null,
    after: row.after ?? null,
    ip: row.ip,
    userAgent: row.userAgent,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A workspace's audit trail (PRD §8.16.3) for its OWNER/ADMIN (`workspace.audit.read`). Every
 * query is filtered on the route's workspace id, set last so no filter can override it
 * (`audit_log` has no RLS: this filter is the isolation).
 */
@Injectable()
export class AuditLogService {
  constructor(@Inject(DB) private readonly db: Pick<GuardedClient, 'auditLog'>) {}

  /**
   * Newest first (`createdAt` desc, then `id` desc): Prisma's cursor compares against the cursor
   * row's own values in SQL, so timestamps keep their microseconds and ties never skip or repeat
   * a row. A cursor that is not a row of this workspace → `422 VALIDATION_FAILED`.
   */
  async list(wid: string, q: AuditLogQuery): Promise<AuditLogPage> {
    if (q.cursor) {
      const row = await this.db.auditLog.findFirst({
        where: { id: q.cursor, workspaceId: wid },
        select: { id: true },
      });
      if (!row) throw validationFailed('cursor', 'Unknown cursor');
    }
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action !== undefined && { action: q.action }),
      ...(q.actorUserId !== undefined && { actorUserId: q.actorUserId }),
      ...((q.from !== undefined || q.to !== undefined) && {
        createdAt: {
          ...(q.from !== undefined && { gte: new Date(q.from) }),
          ...(q.to !== undefined && { lte: new Date(q.to) }),
        },
      }),
      workspaceId: wid,
    };
    const rows = await this.db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor !== undefined && { cursor: { id: q.cursor }, skip: 1 }),
    });
    const items = rows.slice(0, q.limit);
    return {
      items: items.map(toEntry),
      nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null,
    };
  }
}
