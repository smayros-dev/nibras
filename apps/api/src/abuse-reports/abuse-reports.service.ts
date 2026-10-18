import { HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  ABUSE_CLOSED_STATUSES,
  ABUSE_UNDER_REVIEW_STATUSES,
  MINOR_SAFETY_REMINDER_DELAY_MS,
  MINOR_SAFETY_REMINDER_JOB,
  QUEUES,
  minorSafetyReminderJobId,
  type AbuseEntityType,
  type AbuseReport as AbuseReportView,
  type AbuseReportCreated,
  type AbuseReportsPage,
  type AbuseReportsQuery,
  type AdminAbuseReportsQuery,
  type CreateAbuseReportInput,
  type MinorSafetyReminderJob,
  type MyAbuseReportsPage,
  type MyAbuseReportsQuery,
  type UpdateAbuseReportInput,
} from '@nibras/contracts';
import {
  tenantDb,
  type AbuseReport,
  type GuardedClient,
  type Locale,
  type Prisma,
  type User,
} from '@nibras/db';
import type { EmailParams, EmailProvider } from '@nibras/providers';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import type { AuthUser } from '../common/request-context';
import { env } from '../config/env';
import { DB } from '../db/db.module';
import { EMAIL_PROVIDER } from '../providers/providers.module';
import { QueueService } from '../queue/queue.service';
import { validationFailed } from '../workspaces/workspaces.service';
import { SnapshotRegistry, entityTypeUnsupported } from './snapshot.registry';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNDER_REVIEW = [...ABUSE_UNDER_REVIEW_STATUSES];
const CLOSED: readonly string[] = ABUSE_CLOSED_STATUSES;

/** Who handles a report: an organisation's staff on its own queue, or the super-admin. */
export type HandlerScope =
  { kind: 'workspace'; workspaceId: string; userId: string } | { kind: 'admin'; userId: string };

export type CreateAbuseReportCommand = CreateAbuseReportInput & { workspaceId: string | null };

type Recipient = Pick<User, 'id' | 'email' | 'locale'>;
type AbuseEmail =
  | { templateKey: 'abuse.report_received'; params: EmailParams<'abuse.report_received'> }
  | { templateKey: 'abuse.new_report'; params: EmailParams<'abuse.new_report'> };
type ReportRow = AbuseReport & { reporter: Pick<User, 'id' | 'firstName' | 'lastName'> };

const REPORTER = { select: { id: true, firstName: true, lastName: true } } as const;
const RECIPIENT = { id: true, email: true, locale: true } as const;

function notFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}

function origin(): string {
  return env.WEB_ORIGIN.replace(/\/+$/, '');
}

/** The report in the super-admin console. */
export function adminReportLink(locale: Locale, id: string): string {
  return `${origin()}/${locale}/admin/abuse-reports/${id}`;
}

/** The report in the organisation's own queue. */
function workspaceReportLink(locale: Locale, workspaceId: string, id: string): string {
  return `${origin()}/${locale}/app/w/${workspaceId}/abuse-reports/${id}`;
}

function toView(r: ReportRow): AbuseReportView {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    category: r.category,
    description: r.description,
    status: r.status,
    entityType: r.entityType,
    entityId: r.entityId,
    contextSnapshot: (r.contextSnapshot ?? {}) as Record<string, unknown>,
    attachments: r.attachments,
    reporter: {
      userId: r.reporter.id,
      firstName: r.reporter.firstName,
      lastName: r.reporter.lastName,
    },
    assignedToUserId: r.assignedToUserId,
    resolution: r.resolution,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
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
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
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
   * the acknowledgement to the reporter, `abuse.new_report` to the handlers (organisation:
   * ACTIVE OWNER/ADMIN, plus every super-admin for `MINOR_SAFETY`; personal workspace or none:
   * super-admins only; never the reported user nor the reporter), and for `MINOR_SAFETY` the
   * 24 h reminder job.
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
            select: { id: true, type: true },
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
    await this.audit.log({
      action: 'abuse_report.created',
      entityType: 'AbuseReport',
      entityId: report.id,
      ...(workspaceId !== null && { workspaceId }),
      after: {
        category: report.category,
        status: report.status,
        entityType: report.entityType,
        entityId: report.entityId,
        reporterUserId: report.reporterUserId,
      },
    });

    await this.send(reporter, {
      templateKey: 'abuse.report_received',
      params: { firstName: reporter.firstName },
    });
    await this.notifyHandlers(report, workspace?.type === 'ORGANIZATION');
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

  /** A handler's queue: the organisation's reports, or every report for the super-admin. */
  async list(
    scope: HandlerScope,
    q: AbuseReportsQuery & Partial<Pick<AdminAbuseReportsQuery, 'workspaceId'>>,
  ): Promise<AbuseReportsPage> {
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
      items: items.map(toView),
      nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null,
    };
  }

  /** One report of the handler's queue; outside it → `404`. */
  async get(scope: HandlerScope, id: string): Promise<AbuseReportView> {
    return toView(await this.find(scope, id));
  }

  /**
   * Status, resolution and assignee. `RESOLVED`/`DISMISSED` set `resolvedAt` (kept when already
   * closed), `OPEN`/`IN_REVIEW` clear it. The assignee must be an ACTIVE OWNER/ADMIN of the
   * report's workspace or, on the admin route, an active super-admin; never the reported user.
   * Audits `abuse_report.updated` with before/after `{ status, assignedToUserId, resolution }`
   * when something changed.
   */
  async update(
    scope: HandlerScope,
    id: string,
    input: UpdateAbuseReportInput,
  ): Promise<AbuseReportView> {
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
      return toView(current);
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
    return toView(updated);
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
   * `abuse.new_report` to the report's handlers (deduplicated; admin link wins for super-admins;
   * never the reporter nor the reported user). The super-admins are added when the workspace is
   * not an organisation, for `MINOR_SAFETY`, when the reported USER is one of the organisation's
   * handlers (ACTIVE OWNER/ADMIN: he must not be the one instructing it), and whenever no
   * organisation handler is left after the exclusions.
   */
  private async notifyHandlers(report: AbuseReport, organization: boolean): Promise<void> {
    const excluded = new Set([report.reporterUserId]);
    if (report.entityType === 'USER') excluded.add(report.entityId);
    const recipients = new Map<string, { to: Recipient; link: string }>();
    let escalate = !organization || report.category === 'MINOR_SAFETY';

    if (organization && report.workspaceId !== null) {
      const workspaceId = report.workspaceId;
      const staff = await tenantDb(workspaceId).membership.findMany({
        where: { status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
        select: { user: { select: { ...RECIPIENT, status: true } } },
      });
      if (report.entityType === 'USER' && staff.some(({ user }) => user.id === report.entityId)) {
        escalate = true;
      }
      for (const { user } of staff) {
        if (user.status !== 'ACTIVE' || excluded.has(user.id)) continue;
        recipients.set(user.id, {
          to: { id: user.id, email: user.email, locale: user.locale },
          link: workspaceReportLink(user.locale, workspaceId, report.id),
        });
      }
      if (recipients.size === 0) escalate = true;
    }
    if (escalate) {
      const admins = await this.db.user.findMany({
        where: { platformRole: 'SUPER_ADMIN', status: 'ACTIVE' },
        select: RECIPIENT,
      });
      for (const user of admins) {
        recipients.set(user.id, { to: user, link: adminReportLink(user.locale, report.id) });
      }
    }
    // Concurrently: the request must not grow linearly with the number of handlers/super-admins.
    // `send` never rejects (failures are logged per recipient), so one failure blocks no other.
    // Long term these belong on the BullMQ notifications queue, outside the request.
    await Promise.allSettled(
      [...recipients]
        .filter(([id]) => !excluded.has(id))
        .map(([, { to, link }]) =>
          this.send(to, { templateKey: 'abuse.new_report', params: { link } }),
        ),
    );
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

  /** Best effort: the report is stored, a failed email is logged (ids only) and never surfaces. */
  private async send(to: Recipient, mail: AbuseEmail): Promise<void> {
    try {
      await this.email.send({ to: to.email, locale: to.locale, ...mail });
    } catch (err) {
      this.logger.error(
        {
          userId: to.id,
          templateKey: mail.templateKey,
          err: { type: err instanceof Error ? err.name : typeof err },
        },
        'abuse report email not sent',
      );
    }
  }
}
