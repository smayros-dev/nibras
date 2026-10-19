import { HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  ABUSE_CLOSED_STATUSES,
  ABUSE_NOTIFY_ATTEMPTS,
  ABUSE_REPORT_CREATED_JOB,
  ABUSE_UNDER_REVIEW_STATUSES,
  MINOR_SAFETY_REMINDER_DELAY_MS,
  MINOR_SAFETY_REMINDER_JOB,
  QUEUES,
  abuseReportNotifyJobId,
  minorSafetyReminderJobId,
  type AbuseEntityType,
  type AbuseReportCreatedJob,
  type AbuseReport as AbuseReportView,
  type AbuseReportCreated,
  type AbuseReportsPage,
  type AbuseReportsQuery,
  type AdminAbuseReport as AdminAbuseReportView,
  type AdminAbuseReportsPage,
  type AdminAbuseReportsQuery,
  type CreateAbuseReportInput,
  type MinorSafetyReminderJob,
  type MyAbuseReportsPage,
  type MyAbuseReportsQuery,
  type UpdateAbuseReportInput,
} from '@nibras/contracts';
import { tenantDb, type AbuseReport, type GuardedClient, type Prisma, type User } from '@nibras/db';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import type { AuthUser } from '../common/request-context';
import { DB } from '../db/db.module';
import { QueueService } from '../queue/queue.service';
import { validationFailed } from '../workspaces/workspaces.service';
import { SnapshotRegistry, entityTypeUnsupported } from './snapshot.registry';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNDER_REVIEW = [...ABUSE_UNDER_REVIEW_STATUSES];
const CLOSED: readonly string[] = ABUSE_CLOSED_STATUSES;

/** Who handles a report: an organisation's staff on its own queue, or the super-admin. */
export type WorkspaceScope = { kind: 'workspace'; workspaceId: string; userId: string };
export type AdminScope = { kind: 'admin'; userId: string };
export type HandlerScope = WorkspaceScope | AdminScope;

export type CreateAbuseReportCommand = CreateAbuseReportInput & { workspaceId: string | null };

type ReportRow = AbuseReport & { reporter: Pick<User, 'id' | 'firstName' | 'lastName'> };

const REPORTER = { select: { id: true, firstName: true, lastName: true } } as const;

function notFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}

/**
 * The report for its handlers. The reporter is added for the super-admin only (AC-SAFE-02, owner
 * Q1): the organisation view has no `reporter` key at all.
 */
function toView(r: ReportRow, scope: AdminScope): AdminAbuseReportView;
function toView(r: ReportRow, scope: WorkspaceScope): AbuseReportView;
function toView(r: ReportRow, scope: HandlerScope): AbuseReportView | AdminAbuseReportView;
function toView(r: ReportRow, scope: HandlerScope): AbuseReportView | AdminAbuseReportView {
  const view: AbuseReportView = {
    id: r.id,
    workspaceId: r.workspaceId,
    category: r.category,
    description: r.description,
    status: r.status,
    entityType: r.entityType,
    entityId: r.entityId,
    contextSnapshot: (r.contextSnapshot ?? {}) as Record<string, unknown>,
    attachments: r.attachments,
    assignedToUserId: r.assignedToUserId,
    resolution: r.resolution,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
  if (scope.kind !== 'admin') return view;
  return {
    ...view,
    reporter: {
      userId: r.reporter.id,
      firstName: r.reporter.firstName,
      lastName: r.reporter.lastName,
    },
  };
}

/**
 * Abuse reports (PRD §8.16, D-O6, AC-SAFE-02/03/05). `abuse_report` is a platform table (no
 * RLS, not a `TENANT_MODELS` model: a report may have no workspace and the super-admin queue
 * spans all of them), so every query here carries its isolation filter itself: the route's
 * `workspaceId` (organisation queue), the caller as `reporterUserId` (`/me`), or nothing for the
 * super-admin console only. On an organisation's queue, a report whose reported USER is the
 * caller is never shown nor changeable (a reported admin does not handle reports about himself).
 */
@Injectable()
export class AbuseReportsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Pick<GuardedClient, 'abuseReport' | 'user' | 'workspace'>,
    private readonly snapshots: SnapshotRegistry,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(AbuseReportsService.name);
  }

  /** SP1's snapshot provider: `USER` (its membership in the report's workspace, if any). */
  onModuleInit(): void {
    this.snapshots.register('USER', (entityId, workspaceId) =>
      this.userSnapshot(entityId, workspaceId),
    );
  }

  /**
   * `{ userId, firstName, lastName, membership: { role, status } | null, capturedAt }`. With a
   * `workspaceId`, a user without a membership there (any status) is not found: a workspace
   * route never reveals users of other workspaces.
   */
  private async userSnapshot(
    entityId: string,
    workspaceId: string | null,
  ): Promise<Record<string, unknown> | null> {
    const user = await this.db.user.findUnique({
      where: { id: entityId },
      select: { id: true, firstName: true, lastName: true, status: true },
    });
    if (!user || user.status === 'DELETED') return null;
    let membership: { role: string; status: string } | null = null;
    if (workspaceId !== null) {
      membership = await tenantDb(workspaceId).membership.findFirst({
        where: { userId: entityId },
        select: { role: true, status: true },
      });
      if (!membership) return null;
    }
    return {
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      membership,
      capturedAt: new Date().toISOString(),
    };
  }

  /**
   * A new `OPEN` report with the entity's frozen snapshot. Outside a workspace only `USER` may be
   * reported (`422 ENTITY_TYPE_UNSUPPORTED`); reporting oneself → `422 VALIDATION_FAILED`. Once
   * the row is stored: audit `abuse_report.created`, then (best effort, failures only logged)
   * the `abuse.report_created` job on `notifications` — the worker sends the acknowledgement to
   * the reporter and `abuse.new_report` to the handlers, with retries (F12) — and for
   * `MINOR_SAFETY` the 24 h reminder job.
   */
  async create(reporter: AuthUser, input: CreateAbuseReportCommand): Promise<AbuseReportCreated> {
    const { workspaceId } = input;
    if (workspaceId === null && input.entityType !== 'USER') {
      throw entityTypeUnsupported(input.entityType);
    }
    if (input.entityType === 'USER' && input.entityId === reporter.id) {
      throw validationFailed('entityId', 'You cannot report yourself');
    }
    const workspace =
      workspaceId === null
        ? null
        : await this.db.workspace.findUnique({
            where: { id: workspaceId },
            select: { id: true },
          });
    if (workspaceId !== null && !workspace) throw notFound();
    const contextSnapshot = await this.snapshots.snapshot(
      input.entityType,
      input.entityId,
      workspaceId,
    );

    const report = await this.db.abuseReport.create({
      data: {
        workspaceId,
        reporterUserId: reporter.id,
        category: input.category,
        description: input.description,
        entityType: input.entityType,
        entityId: input.entityId,
        contextSnapshot: contextSnapshot as Prisma.InputJsonObject,
        attachments: input.attachments ?? [],
        status: 'OPEN',
      },
    });
    // The workspace's OWNER/ADMIN read this row: it never names the reporter, neither in `after`
    // nor as its actor (AC-SAFE-02, owner Q1). The reporter is on the report itself.
    await this.audit.log({
      action: 'abuse_report.created',
      entityType: 'AbuseReport',
      entityId: report.id,
      ...(workspaceId !== null && { workspaceId }),
      hideActor: true,
      after: {
        category: report.category,
        status: report.status,
        entityType: report.entityType,
        entityId: report.entityId,
      },
    });

    await this.enqueueNotifications(report.id);
    if (report.category === 'MINOR_SAFETY') await this.scheduleReminder(report.id);
    return { id: report.id, status: report.status };
  }

  /** `GET /me/abuse-reports`: the caller's reports only, newest first, no snapshot. */
  async listMine(userId: string, q: MyAbuseReportsQuery): Promise<MyAbuseReportsPage> {
    const where: Prisma.AbuseReportWhereInput = { reporterUserId: userId };
    const rows = await this.db.abuseReport.findMany({
      ...(await this.pageArgs(where, q)),
      select: {
        id: true,
        category: true,
        status: true,
        entityType: true,
        createdAt: true,
        resolvedAt: true,
      },
    });
    const items = rows.slice(0, q.limit);
    return {
      items: items.map((r) => ({
        id: r.id,
        category: r.category,
        status: r.status,
        entityType: r.entityType,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
      })),
      nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null,
    };
  }

  /**
   * A handler's queue: the organisation's reports (no reporter), or every report with its
   * reporter for the super-admin.
   */
  async list(scope: AdminScope, q: AdminAbuseReportsQuery): Promise<AdminAbuseReportsPage>;
  async list(scope: WorkspaceScope, q: AbuseReportsQuery): Promise<AbuseReportsPage>;
  async list(
    scope: HandlerScope,
    q: AbuseReportsQuery & Partial<Pick<AdminAbuseReportsQuery, 'workspaceId'>>,
  ): Promise<AbuseReportsPage | AdminAbuseReportsPage> {
    const where: Prisma.AbuseReportWhereInput = {
      ...(q.status !== undefined && { status: q.status }),
      ...(q.category !== undefined && { category: q.category }),
      ...(scope.kind === 'admin' && q.workspaceId !== undefined && { workspaceId: q.workspaceId }),
      ...this.scopeFilter(scope),
    };
    const rows = await this.db.abuseReport.findMany({
      ...(await this.pageArgs(where, q)),
      include: { reporter: REPORTER },
    });
    const items = rows.slice(0, q.limit);
    return {
      items: items.map((r) => toView(r, scope)),
      nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null,
    };
  }

  /** One report of the handler's queue; outside it → `404`. The reporter: super-admin only. */
  async get(scope: AdminScope, id: string): Promise<AdminAbuseReportView>;
  async get(scope: WorkspaceScope, id: string): Promise<AbuseReportView>;
  async get(scope: HandlerScope, id: string): Promise<AbuseReportView | AdminAbuseReportView> {
    return toView(await this.find(scope, id), scope);
  }

  /**
   * Status, resolution and assignee. `RESOLVED`/`DISMISSED` set `resolvedAt` (kept when already
   * closed), `OPEN`/`IN_REVIEW` clear it. The assignee must be an ACTIVE OWNER/ADMIN of the
   * report's workspace or, on the admin route, an active super-admin; never the reported user.
   * Audits `abuse_report.updated` with before/after `{ status, assignedToUserId, resolution }`
   * when something changed.
   */
  async update(
    scope: AdminScope,
    id: string,
    input: UpdateAbuseReportInput,
  ): Promise<AdminAbuseReportView>;
  async update(
    scope: WorkspaceScope,
    id: string,
    input: UpdateAbuseReportInput,
  ): Promise<AbuseReportView>;
  async update(
    scope: HandlerScope,
    id: string,
    input: UpdateAbuseReportInput,
  ): Promise<AbuseReportView | AdminAbuseReportView> {
    const current = await this.find(scope, id);
    if (input.assignedToUserId) await this.assertAssignable(scope, current, input.assignedToUserId);

    const status = input.status ?? current.status;
    const resolvedAt = CLOSED.includes(status) ? (current.resolvedAt ?? new Date()) : null;
    const assignedToUserId =
      input.assignedToUserId !== undefined ? input.assignedToUserId : current.assignedToUserId;
    const resolution = input.resolution !== undefined ? input.resolution : current.resolution;
    const before = {
      status: current.status,
      assignedToUserId: current.assignedToUserId,
      resolution: current.resolution,
    };
    const after = { status, assignedToUserId, resolution };
    if (
      before.status === after.status &&
      before.assignedToUserId === after.assignedToUserId &&
      before.resolution === after.resolution
    ) {
      return toView(current, scope);
    }
    const updated = await this.db.abuseReport.update({
      where: { id: current.id },
      data: { status, resolvedAt, assignedToUserId, resolution },
      include: { reporter: REPORTER },
    });
    await this.audit.log({
      action: 'abuse_report.updated',
      entityType: 'AbuseReport',
      entityId: updated.id,
      ...(updated.workspaceId !== null && { workspaceId: updated.workspaceId }),
      before,
      after,
    });
    return toView(updated, scope);
  }

  /** AC-SAFE-03 hook (SP8 `409 MESSAGE_UNDER_REVIEW`): a report on the entity is OPEN/IN_REVIEW. */
  async isEntityUnderReview(entityType: AbuseEntityType, entityId: string): Promise<boolean> {
    const count = await this.db.abuseReport.count({
      where: { entityType, entityId, status: { in: UNDER_REVIEW } },
    });
    return count > 0;
  }

  /** Organisation queue: its reports, minus those whose reported user is the caller. */
  private scopeFilter(scope: HandlerScope): Prisma.AbuseReportWhereInput {
    if (scope.kind === 'admin') return {};
    return {
      workspaceId: scope.workspaceId,
      NOT: { entityType: 'USER', entityId: scope.userId },
    };
  }

  private async find(scope: HandlerScope, id: string): Promise<ReportRow> {
    if (!UUID.test(id)) throw notFound();
    const report = await this.db.abuseReport.findFirst({
      where: { AND: [{ id }, this.scopeFilter(scope)] },
      include: { reporter: REPORTER },
    });
    if (!report) throw notFound();
    return report;
  }

  /**
   * Newest first (`createdAt` desc, `id` desc) with Prisma's cursor on the row id (compared in
   * SQL, so microsecond timestamps never skip or repeat a row). A cursor outside `where` → `422`.
   */
  private async pageArgs(
    where: Prisma.AbuseReportWhereInput,
    q: { cursor?: string; limit: number },
  ) {
    if (q.cursor !== undefined) {
      const row = await this.db.abuseReport.findFirst({
        where: { AND: [where, { id: q.cursor }] },
        select: { id: true },
      });
      if (!row) throw validationFailed('cursor', 'Unknown cursor');
    }
    return {
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor !== undefined && { cursor: { id: q.cursor }, skip: 1 }),
    } satisfies Prisma.AbuseReportFindManyArgs;
  }

  private async assertAssignable(
    scope: HandlerScope,
    report: AbuseReport,
    userId: string,
  ): Promise<void> {
    const reported = report.entityType === 'USER' && report.entityId === userId;
    if (!reported && report.workspaceId !== null) {
      const staff = await tenantDb(report.workspaceId).membership.findFirst({
        where: { userId, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
        select: { id: true },
      });
      if (staff) return;
    }
    if (!reported && scope.kind === 'admin') {
      const admin = await this.db.user.findFirst({
        where: { id: userId, platformRole: 'SUPER_ADMIN', status: 'ACTIVE' },
        select: { id: true },
      });
      if (admin) return;
    }
    throw validationFailed('assignedToUserId', 'The assignee cannot handle this report');
  }

  /**
   * The acknowledgement and the handlers' emails, sent by the worker (`abuse.report_created`, one
   * job per report, retried; F12). A failed enqueue is logged: the report exists and the
   * super-admin queue lists it.
   */
  private async enqueueNotifications(reportId: string): Promise<void> {
    const data: AbuseReportCreatedJob = { reportId };
    try {
      await this.queue.add(QUEUES.notifications, ABUSE_REPORT_CREATED_JOB, data, {
        jobId: abuseReportNotifyJobId(reportId),
        attempts: ABUSE_NOTIFY_ATTEMPTS,
      });
    } catch (err) {
      this.logger.error(
        { reportId, err: { type: err instanceof Error ? err.name : typeof err } },
        'abuse report notifications not enqueued',
      );
    }
  }

  /** The 24 h MINOR_SAFETY reminder (AC-SAFE-05); one job per report (`jobId`). */
  private async scheduleReminder(reportId: string): Promise<void> {
    const data: MinorSafetyReminderJob = { reportId };
    try {
      await this.queue.add(QUEUES.compliance, MINOR_SAFETY_REMINDER_JOB, data, {
        delay: MINOR_SAFETY_REMINDER_DELAY_MS,
        jobId: minorSafetyReminderJobId(reportId),
      });
    } catch (err) {
      this.logger.error(
        { reportId, err: { type: err instanceof Error ? err.name : typeof err } },
        'minor-safety reminder not scheduled',
      );
    }
  }
}
