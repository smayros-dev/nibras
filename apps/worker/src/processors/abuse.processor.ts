import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { MINOR_SAFETY_REMINDER_JOB, QUEUES, type MinorSafetyReminderJob } from '@nibras/contracts';
import type { PrismaClient } from '@nibras/db';
import type { EmailProvider } from '@nibras/providers';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';

import { WORKER_ENV, type WorkerEnv } from '../env';
import { WORKER_LOGGER } from '../logger';
import { EMAIL_PROVIDER } from '../providers';
import { ProcessorRegistry } from '../queues';
import { WORKER_DB } from '../worker-db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Job progress: the super-admins already reminded, so a retry never emails them twice. */
interface ReminderProgress {
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

/**
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
    const origin = this.env.WEB_ORIGIN.replace(/\/+$/, '');
    let failed = 0;
    for (const admin of admins) {
      if (sentTo.includes(admin.id)) continue;
      try {
        await this.email.send({
          to: admin.email,
          templateKey: 'abuse.minor_safety_reminder',
          locale: admin.locale,
          params: { link: `${origin}/${admin.locale}/admin/abuse-reports/${reportId}` },
        });
        sentTo.push(admin.id);
        await job.updateProgress({ sentTo } satisfies ReminderProgress);
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
