import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  ABUSE_REPORT_CREATED_JOB,
  MINOR_SAFETY_REMINDER_JOB,
  QUEUES,
  abuseReportLinks,
  type AbuseReportCreatedJob,
  type MinorSafetyReminderJob,
} from '@nibras/contracts';
import type { Locale, PrismaClient } from '@nibras/db';
import type { EmailParams, EmailProvider } from '@nibras/providers';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';

import { WORKER_ENV, type WorkerEnv } from '../env';
import { WORKER_LOGGER } from '../logger';
import { EMAIL_PROVIDER } from '../providers';
import { ProcessorRegistry } from '../queues';
import { WORKER_DB } from '../worker-db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Job progress: the users already emailed, so a retry never emails them twice. */
interface SentToProgress {
  sentTo: string[];
}

function sentSoFar(progress: unknown): string[] {
  if (progress && typeof progress === 'object' && 'sentTo' in progress) {
    const { sentTo } = progress as { sentTo: unknown };
    if (Array.isArray(sentTo)) return sentTo.filter((x): x is string => typeof x === 'string');
  }
  return [];
}

export interface MinorSafetyReminderResult {
  sent: number;
  skipped?: 'not_open' | 'not_found';
}

export interface ReportCreatedResult {
  sent: number;
  skipped?: 'not_found';
}

type ReportEmail =
  | { templateKey: 'abuse.report_received'; params: EmailParams<'abuse.report_received'> }
  | { templateKey: 'abuse.new_report'; params: EmailParams<'abuse.new_report'> };

interface Notification {
  userId: string;
  to: string;
  locale: Locale;
  mail: ReportEmail;
}

const RECIPIENT = { id: true, email: true, locale: true } as const;

/**
 * `abuse.report_created` on `notifications` (F12), enqueued by the API once a report is stored
 * (`jobId = abuse:{id}:notify`, 5 attempts): the acknowledgement to the reporter, then
 * `abuse.new_report` to the handlers (organisation: ACTIVE OWNER/ADMIN with the organisation
 * link; super-admins with the admin link), never the reporter nor the reported user, and never
 * naming the reporter (AC-SAFE-02, owner Q1).
 *
 * `abuse.minor_safety_reminder` on `compliance` (AC-SAFE-05), enqueued by the API 24 h after a
 * MINOR_SAFETY report with `jobId = abuse:{id}:minor-safety-reminder` (BullMQ ignores a second
 * job with the same id). Still `OPEN` → `abuse.minor_safety_reminder` to every active
 * SUPER_ADMIN; any other status, or no such report → no-op. A failed email fails the job (BullMQ
 * retries it); the recipients already reached are kept in the job progress and skipped.
 */
@Injectable()
export class AbuseProcessor implements OnModuleInit {
  constructor(
    private readonly registry: ProcessorRegistry,
    @Inject(WORKER_DB) private readonly db: PrismaClient,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.registry.registerProcessor(QUEUES.compliance, MINOR_SAFETY_REMINDER_JOB, (job) =>
      this.minorSafetyReminder(job as Job<MinorSafetyReminderJob>),
    );
    this.registry.registerProcessor(QUEUES.notifications, ABUSE_REPORT_CREATED_JOB, (job) =>
      this.reportCreated(job as Job<AbuseReportCreatedJob>),
    );
  }

  /**
   * Sends the report's notifications sequentially (reporter first, then by user id). A failed
   * email fails the job once every other recipient was tried (BullMQ retries it); the users
   * already reached are kept in the job progress (`sentTo`) and skipped (Review Focus 5).
   */
  async reportCreated(job: Job<AbuseReportCreatedJob>): Promise<ReportCreatedResult> {
    const { reportId } = job.data;
    if (typeof reportId !== 'string' || !UUID.test(reportId)) {
      return { sent: 0, skipped: 'not_found' };
    }
    const report = await this.db.abuseReport.findUnique({
      where: { id: reportId },
      include: { reporter: { select: { ...RECIPIENT, firstName: true } } },
    });
    if (!report) return { sent: 0, skipped: 'not_found' };

    const { reporter } = report;
    const notifications: Notification[] = [
      {
        userId: reporter.id,
        to: reporter.email,
        locale: reporter.locale,
        mail: { templateKey: 'abuse.report_received', params: { firstName: reporter.firstName } },
      },
      ...(await this.handlers(report)),
    ];

    const sentTo = sentSoFar(job.progress);
    let failed = 0;
    for (const n of notifications) {
      if (sentTo.includes(n.userId)) continue;
      try {
        await this.email.send({ to: n.to, locale: n.locale, ...n.mail });
        sentTo.push(n.userId);
        await job.updateProgress({ sentTo } satisfies SentToProgress);
      } catch (err) {
        failed += 1;
        this.logger.error(
          {
            reportId,
            userId: n.userId,
            templateKey: n.mail.templateKey,
            err: { type: err instanceof Error ? err.name : typeof err },
          },
          'abuse report email not sent',
        );
      }
    }
    if (failed > 0) throw new Error(`abuse report notifications: ${failed} email(s) not sent`);
    this.logger.info({ reportId, recipients: sentTo.length }, 'abuse report notifications sent');
    return { sent: sentTo.length };
  }

  /**
   * `abuse.new_report` recipients, ordered by user id (deduplicated; the admin link wins for
   * super-admins; never the reporter nor the reported user). The super-admins are added when the
   * workspace is not an organisation, for `MINOR_SAFETY`, when the reported USER is one of the
   * organisation's handlers (ACTIVE OWNER/ADMIN: he must not be the one instructing it), and
   * whenever no organisation handler is left after the exclusions.
   */
  private async handlers(report: {
    id: string;
    workspaceId: string | null;
    reporterUserId: string;
    category: string;
    entityType: string;
    entityId: string;
  }): Promise<Notification[]> {
    const origin = this.env.WEB_ORIGIN;
    const workspace =
      report.workspaceId === null
        ? null
        : await this.db.workspace.findUnique({
            where: { id: report.workspaceId },
            select: { type: true },
          });
    const organization = workspace?.type === 'ORGANIZATION';
    const excluded = new Set([report.reporterUserId]);
    if (report.entityType === 'USER') excluded.add(report.entityId);
    const recipients = new Map<string, { to: string; locale: Locale; link: string }>();
    let escalate = !organization || report.category === 'MINOR_SAFETY';

    if (organization && report.workspaceId !== null) {
      const staff = await this.db.membership.findMany({
        where: {
          workspaceId: report.workspaceId,
          status: 'ACTIVE',
          role: { in: ['OWNER', 'ADMIN'] },
        },
        select: { user: { select: { ...RECIPIENT, status: true } } },
      });
      if (report.entityType === 'USER' && staff.some(({ user }) => user.id === report.entityId)) {
        escalate = true;
      }
      for (const { user } of staff) {
        if (user.status !== 'ACTIVE' || excluded.has(user.id)) continue;
        const links = abuseReportLinks(origin, user.locale, report.workspaceId, report.id);
        recipients.set(user.id, { to: user.email, locale: user.locale, link: links.workspace! });
      }
      if (recipients.size === 0) escalate = true;
    }
    if (escalate) {
      const admins = await this.db.user.findMany({
        where: { platformRole: 'SUPER_ADMIN', status: 'ACTIVE' },
        select: RECIPIENT,
      });
      for (const user of admins) {
        const links = abuseReportLinks(origin, user.locale, report.workspaceId, report.id);
        recipients.set(user.id, { to: user.email, locale: user.locale, link: links.admin });
      }
    }
    return [...recipients]
      .filter(([id]) => !excluded.has(id))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([userId, { to, locale, link }]) => ({
        userId,
        to,
        locale,
        mail: { templateKey: 'abuse.new_report', params: { link } },
      }));
  }

  async minorSafetyReminder(job: Job<MinorSafetyReminderJob>): Promise<MinorSafetyReminderResult> {
    const { reportId } = job.data;
    if (typeof reportId !== 'string' || !UUID.test(reportId))
      return { sent: 0, skipped: 'not_found' };
    const report = await this.db.abuseReport.findUnique({
      where: { id: reportId },
      select: { status: true },
    });
    if (!report) return { sent: 0, skipped: 'not_found' };
    if (report.status !== 'OPEN') return { sent: 0, skipped: 'not_open' };

    const admins = await this.db.user.findMany({
      where: { platformRole: 'SUPER_ADMIN', status: 'ACTIVE' },
      select: { id: true, email: true, locale: true },
      orderBy: { id: 'asc' },
    });
    const sentTo = sentSoFar(job.progress);
    let failed = 0;
    for (const admin of admins) {
      if (sentTo.includes(admin.id)) continue;
      try {
        await this.email.send({
          to: admin.email,
          templateKey: 'abuse.minor_safety_reminder',
          locale: admin.locale,
          params: {
            link: abuseReportLinks(this.env.WEB_ORIGIN, admin.locale, null, reportId).admin,
          },
        });
        sentTo.push(admin.id);
        await job.updateProgress({ sentTo } satisfies SentToProgress);
      } catch (err) {
        failed += 1;
        this.logger.error(
          {
            reportId,
            userId: admin.id,
            err: { type: err instanceof Error ? err.name : typeof err },
          },
          'minor-safety reminder email not sent',
        );
      }
    }
    if (failed > 0) throw new Error(`minor-safety reminder: ${failed} email(s) not sent`);
    this.logger.info({ reportId, recipients: sentTo.length }, 'minor-safety reminder sent');
    return { sent: sentTo.length };
  }
}
