import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  QUEUES,
  type AdminHealth,
  type AdminQueueHealth,
  type AdminWorkspacesPage,
  type AdminWorkspacesQuery,
  type QueueName,
  type UpdateWorkspaceQuotaInput,
  type WorkspaceStorage,
} from '@tt/contracts';
import { crossTenantDb, withTenantTx, type GuardedClient, type Prisma } from '@tt/db';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { RequestContext, type AuthUser } from '../common/request-context';
import { withTimeout } from '../common/with-timeout';
import { DB } from '../db/db.module';
import { QUEUES_BY_NAME } from '../queue/queue.service';
import { REDIS } from '../redis/redis.module';
import { lockWorkspace } from '../workspaces/workspace-settings.service';
import { validationFailed } from '../workspaces/workspaces.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A dependency that does not answer within this budget counts as down. */
const PROBE_TIMEOUT_MS = 1000;
const QUEUE_NAMES = Object.values(QUEUES);

const WORKSPACE_ROW = {
  id: true,
  type: true,
  name: true,
  slug: true,
  status: true,
  suspendedReason: true,
  storageUsedBytes: true,
  storageQuotaBytes: true,
  createdAt: true,
} as const satisfies Prisma.WorkspaceSelect;

export function notFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}

/** The audit actor of a console action (also valid outside a request). */
export function adminActor(actor: Pick<AuthUser, 'id'>) {
  return { userId: actor.id, role: 'SUPER_ADMIN' } as const;
}

/**
 * Super-admin console (PRD §8.16.4, US-X01/X02/X03): workspace list, suspension, quota, health.
 * `workspace` is a platform table (not under RLS), so the list reads it directly; only the
 * member counts cross tenants, through `crossTenantDb({ reason: 'super_admin' })` (verified
 * actor, audited `admin.cross_tenant_query`). Every mutation locks the workspace row, so a
 * concurrent change is never lost, and is idempotent: a repeat changes nothing and writes no
 * audit row.
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'workspace' | '$queryRaw'>,
    @Inject(REDIS) private readonly redis: Pick<Redis, 'ping'>,
    @Inject(QUEUES_BY_NAME) private readonly queues: ReadonlyMap<QueueName, Queue>,
    private readonly audit: AuditService,
  ) {}

  /** `GET /admin/workspaces`: newest first, Prisma cursor on the id (unknown cursor → `422`). */
  async listWorkspaces(actor: AuthUser, q: AdminWorkspacesQuery): Promise<AdminWorkspacesPage> {
    const where: Prisma.WorkspaceWhereInput = {
      ...(q.type !== undefined && { type: q.type }),
      ...(q.status !== undefined && { status: q.status }),
      ...(q.q !== undefined && {
        OR: [
          { name: { contains: q.q, mode: 'insensitive' } },
          { slug: { contains: q.q, mode: 'insensitive' } },
        ],
      }),
    };
    if (q.cursor !== undefined) {
      const row = await this.db.workspace.findFirst({
        where: { AND: [where, { id: q.cursor }] },
        select: { id: true },
      });
      if (!row) throw validationFailed('cursor', 'Unknown cursor');
    }
    const rows = await this.db.workspace.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor !== undefined && { cursor: { id: q.cursor }, skip: 1 }),
      select: WORKSPACE_ROW,
    });
    const items = rows.slice(0, q.limit);
    const counts = await this.memberCounts(
      actor,
      items.map((w) => w.id),
    );
    return {
      items: items.map((w) => ({
        id: w.id,
        type: w.type,
        name: w.name,
        slug: w.slug,
        status: w.status,
        suspendedReason: w.suspendedReason,
        memberCount: counts.get(w.id) ?? 0,
        storageUsedBytes: w.storageUsedBytes.toString(),
        storageQuotaBytes: w.storageQuotaBytes.toString(),
        createdAt: w.createdAt.toISOString(),
      })),
      nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null,
    };
  }

  /**
   * `ACTIVE` → `SUSPENDED` with `reason` (read-only for its members: `423` on mutations, AC-WS-06);
   * audits `workspace.suspended`. Already suspended (whatever the reason) → no-op; `DELETING` →
   * `422`; unknown → `404`.
   */
  async suspendWorkspace(actor: AuthUser, wid: string, reason: string): Promise<void> {
    if (!UUID.test(wid)) throw notFound();
    const suspendedAt = new Date();
    const changed = await withTenantTx(wid, async (tx) => {
      await lockWorkspace(tx, wid);
      const w = await tx.workspace.findUnique({ where: { id: wid }, select: { status: true } });
      if (!w) throw notFound();
      if (w.status === 'DELETING') {
        throw validationFailed('status', 'A workspace being deleted cannot be suspended');
      }
      if (w.status === 'SUSPENDED') return false;
      await tx.workspace.update({
        where: { id: wid },
        data: { status: 'SUSPENDED', suspendedReason: reason, suspendedAt },
      });
      return true;
    });
    if (!changed) return;
    await this.audit.log({
      action: 'workspace.suspended',
      entityType: 'Workspace',
      entityId: wid,
      workspaceId: wid,
      actorOverride: adminActor(actor),
      before: { status: 'ACTIVE', suspendedReason: null },
      after: { status: 'SUSPENDED', suspendedReason: reason, suspendedAt },
    });
  }

  /**
   * `SUSPENDED` → `ACTIVE` (reason and date cleared), including a personal workspace suspended
   * with its owner (`OWNER_SUSPENDED`: the admin may lift it on its own). Audits
   * `workspace.unsuspended`. Already ACTIVE → no-op; `DELETING` → `422`; unknown → `404`.
   */
  async unsuspendWorkspace(actor: AuthUser, wid: string): Promise<void> {
    if (!UUID.test(wid)) throw notFound();
    const before = await withTenantTx(wid, async (tx) => {
      await lockWorkspace(tx, wid);
      const w = await tx.workspace.findUnique({
        where: { id: wid },
        select: { status: true, suspendedReason: true },
      });
      if (!w) throw notFound();
      if (w.status === 'DELETING') {
        throw validationFailed('status', 'A workspace being deleted cannot be reactivated');
      }
      if (w.status === 'ACTIVE') return null;
      await tx.workspace.update({
        where: { id: wid },
        data: { status: 'ACTIVE', suspendedReason: null, suspendedAt: null },
      });
      return w;
    });
    if (!before) return;
    await this.audit.log({
      action: 'workspace.unsuspended',
      entityType: 'Workspace',
      entityId: wid,
      workspaceId: wid,
      actorOverride: adminActor(actor),
      before: { status: before.status, suspendedReason: before.suspendedReason },
      after: { status: 'ACTIVE' },
    });
  }

  /**
   * `PATCH /admin/workspaces/{wid}/quota` (US-X03): below the bytes in use → `422`
   * (`storageQuotaBytes`); the schema already bounds it to 0..10 TiB. Audits
   * `workspace.quota_changed` with before/after when it changed.
   */
  async updateQuota(
    actor: AuthUser,
    wid: string,
    input: UpdateWorkspaceQuotaInput,
  ): Promise<WorkspaceStorage> {
    if (!UUID.test(wid)) throw notFound();
    const quota = BigInt(input.storageQuotaBytes);
    const { previous, used } = await withTenantTx(wid, async (tx) => {
      await lockWorkspace(tx, wid);
      const w = await tx.workspace.findUnique({
        where: { id: wid },
        select: { storageQuotaBytes: true, storageUsedBytes: true },
      });
      if (!w) throw notFound();
      if (quota < w.storageUsedBytes) {
        throw validationFailed(
          'storageQuotaBytes',
          `Below the storage in use (${w.storageUsedBytes.toString()} bytes)`,
        );
      }
      if (quota !== w.storageQuotaBytes) {
        await tx.workspace.update({ where: { id: wid }, data: { storageQuotaBytes: quota } });
      }
      return { previous: w.storageQuotaBytes, used: w.storageUsedBytes };
    });
    if (quota !== previous) {
      await this.audit.log({
        action: 'workspace.quota_changed',
        entityType: 'Workspace',
        entityId: wid,
        workspaceId: wid,
        actorOverride: adminActor(actor),
        before: { storageQuotaBytes: previous },
        after: { storageQuotaBytes: quota },
      });
    }
    return { quotaBytes: quota.toString(), usedBytes: used.toString() };
  }

  /**
   * `GET /admin/health` (US-X02): database and Redis reachability, and the waiting / active /
   * delayed / failed job counts of every queue of `QUEUES` (in that order; `null` counts when
   * Redis did not answer). Each probe has a 1 s budget.
   */
  async health(): Promise<AdminHealth> {
    const probe = async (ping: () => Promise<unknown>) => {
      try {
        await withTimeout(ping(), PROBE_TIMEOUT_MS);
        return 'up' as const;
      } catch {
        return 'down' as const;
      }
    };
    const [db, redis, queues] = await Promise.all([
      probe(() => this.db.$queryRaw`SELECT 1`),
      probe(() => this.redis.ping()),
      Promise.all(QUEUE_NAMES.map((name) => this.queueCounts(name))),
    ]);
    return { db, redis, queues };
  }

  private async queueCounts(name: QueueName): Promise<AdminQueueHealth> {
    try {
      const queue = this.queues.get(name);
      if (!queue) throw new Error(`unknown queue ${name}`);
      const c = await withTimeout(
        queue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
        PROBE_TIMEOUT_MS,
      );
      return {
        name,
        waiting: c.waiting ?? 0,
        active: c.active ?? 0,
        delayed: c.delayed ?? 0,
        failed: c.failed ?? 0,
      };
    } catch {
      return { name, waiting: null, active: null, delayed: null, failed: null };
    }
  }

  /**
   * ACTIVE memberships per workspace: the one cross-tenant aggregate without a user filter
   * (`crossTenantDb({ reason: 'super_admin' })`, audited per query).
   */
  private async memberCounts(actor: AuthUser, ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const requestId = RequestContext.get()?.requestId ?? `system-${randomUUID()}`;
    const groups = await crossTenantDb({
      reason: 'super_admin',
      actor: { userId: actor.id, requestId },
    }).membership.groupBy({
      by: ['workspaceId'],
      where: { workspaceId: { in: ids }, status: 'ACTIVE' },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.workspaceId, g._count._all]));
  }
}
