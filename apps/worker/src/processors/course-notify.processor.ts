import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  COURSE_ASSIGNED_NOTIFY_JOB,
  COURSE_PUBLISHED_NOTIFY_JOB,
  QUEUES,
  studentCourseLink,
  type CourseAssignedNotifyJob,
  type CoursePublishedNotifyJob,
} from '@nibras/contracts';
import type { Locale, PrismaClient } from '@nibras/db';
import type { EmailProvider } from '@nibras/providers';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';

import { WORKER_ENV, type WorkerEnv } from '../env';
import { WORKER_LOGGER } from '../logger';
import { EMAIL_PROVIDER } from '../providers';
import { ProcessorRegistry } from '../queues';
import { WORKER_DB } from '../worker-db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `sent`: emails sent by this run (a retry counts only the ones it sent). */
export interface CourseNotifyResult {
  sent: number;
  skipped?: 'not_published';
}

/**
 * Job progress: the keys already emailed (enrollment ids for `course.assigned`, user ids for
 * `course.published`), so a retry never emails them twice (the SP1.6 `sentTo` pattern; same
 * at-least-once window as `AbuseProcessor`: a progress write lost between a send and a crash).
 */
function sentSoFar(progress: unknown): string[] {
  if (progress && typeof progress === 'object' && 'sentTo' in progress) {
    const { sentTo } = progress as { sentTo: unknown };
    if (Array.isArray(sentTo)) return sentTo.filter((x): x is string => typeof x === 'string');
  }
  return [];
}

interface Recipient {
  /** The `sentTo` key. */
  key: string;
  userId: string;
  to: string;
  locale: Locale;
  firstName: string;
}

interface CourseFacts {
  id: string;
  title: string;
  teacherName: string;
  workspaceName: string;
}

const errType = (err: unknown) => ({ type: err instanceof Error ? err.name : typeof err });

/**
 * The interim course emails on `notifications` (spec §4.5, D14, Q3; SP7 replaces them with the
 * notification centre). Both re-check everything at run time: the course is live and still
 * PUBLISHED, the enrollment still ACTIVE, the student's membership ACTIVE (a minor waiting for
 * consent or a student waiting for approval is not told about a course he cannot open yet) and
 * his account ACTIVE.
 *
 * - `course.assigned_notify { workspaceId, enrollmentIds }` (enqueued by the API at assignment):
 *   `course.assigned` per enrollment of that workspace (ids of another workspace are never read).
 * - `course.published_notify { workspaceId, courseId }` (one job per published version): every
 *   ACTIVE enrollment of the course gets `course.published`; a course no longer PUBLISHED → no-op.
 *
 * A failed email fails the job once every other recipient was tried (BullMQ retries it); the
 * recipients already reached are kept in the job progress and skipped.
 */
@Injectable()
export class CourseNotifyProcessor implements OnModuleInit {
  constructor(
    private readonly registry: ProcessorRegistry,
    @Inject(WORKER_DB) private readonly db: PrismaClient,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.registry.registerProcessor(QUEUES.notifications, COURSE_ASSIGNED_NOTIFY_JOB, (job) =>
      this.assigned(job as Job<CourseAssignedNotifyJob>),
    );
    this.registry.registerProcessor(QUEUES.notifications, COURSE_PUBLISHED_NOTIFY_JOB, (job) =>
      this.published(job as Job<CoursePublishedNotifyJob>),
    );
  }

  async assigned(job: Job<CourseAssignedNotifyJob>): Promise<CourseNotifyResult> {
    const { workspaceId } = job.data;
    const ids = Array.isArray(job.data.enrollmentIds)
      ? job.data.enrollmentIds.filter((id): id is string => typeof id === 'string' && UUID.test(id))
      : [];
    if (typeof workspaceId !== 'string' || !UUID.test(workspaceId) || ids.length === 0) {
      return { sent: 0 };
    }
    const rows = await this.db.enrollment.findMany({
      where: {
        id: { in: ids },
        workspaceId,
        status: 'ACTIVE',
        course: { status: 'PUBLISHED', deletedAt: null },
      },
      select: { id: true, courseId: true, studentUserId: true },
      orderBy: { id: 'asc' },
    });
    const active = await this.activeStudents(
      workspaceId,
      rows.map((r) => r.studentUserId),
    );
    const byCourse = new Map<string, Recipient[]>();
    for (const r of rows) {
      const user = active.get(r.studentUserId);
      if (!user) continue;
      const list = byCourse.get(r.courseId) ?? [];
      list.push({ ...user, key: r.id });
      byCourse.set(r.courseId, list);
    }
    const sentTo = sentSoFar(job.progress);
    let sent = 0;
    let failed = 0;
    for (const [courseId, recipients] of byCourse) {
      const course = await this.course(courseId);
      if (!course) continue;
      const r = await this.sendAll(job, 'course.assigned', course, recipients, sentTo);
      sent += r.sent;
      failed += r.failed;
    }
    return this.finish(job, sentTo, sent, failed, { workspaceId, kind: 'assigned' });
  }

  async published(job: Job<CoursePublishedNotifyJob>): Promise<CourseNotifyResult> {
    const { workspaceId, courseId } = job.data;
    if (
      typeof workspaceId !== 'string' ||
      typeof courseId !== 'string' ||
      !UUID.test(workspaceId) ||
      !UUID.test(courseId)
    ) {
      return { sent: 0, skipped: 'not_published' };
    }
    const live = await this.db.course.findFirst({
      where: { id: courseId, workspaceId, status: 'PUBLISHED', deletedAt: null },
      select: { id: true },
    });
    if (!live) return { sent: 0, skipped: 'not_published' };
    const course = await this.course(courseId);
    if (!course) return { sent: 0, skipped: 'not_published' };
    const rows = await this.db.enrollment.findMany({
      where: { courseId, workspaceId, status: 'ACTIVE' },
      select: { studentUserId: true },
      orderBy: { studentUserId: 'asc' },
    });
    const active = await this.activeStudents(
      workspaceId,
      rows.map((r) => r.studentUserId),
    );
    const recipients = rows.flatMap((r) => {
      const user = active.get(r.studentUserId);
      return user ? [{ ...user, key: user.userId }] : [];
    });
    const sentTo = sentSoFar(job.progress);
    const r = await this.sendAll(job, 'course.published', course, recipients, sentTo);
    return this.finish(job, sentTo, r.sent, r.failed, { workspaceId, courseId, kind: 'published' });
  }

  /** The students of `userIds` whose membership in the workspace and account are ACTIVE. */
  private async activeStudents(
    workspaceId: string,
    userIds: string[],
  ): Promise<Map<string, Omit<Recipient, 'key'>>> {
    if (userIds.length === 0) return new Map();
    const members = await this.db.membership.findMany({
      where: {
        workspaceId,
        userId: { in: userIds },
        role: 'STUDENT',
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
      },
      select: { user: { select: { id: true, email: true, locale: true, firstName: true } } },
    });
    return new Map(
      members.map(({ user }) => [
        user.id,
        { userId: user.id, to: user.email, locale: user.locale, firstName: user.firstName },
      ]),
    );
  }

  private async course(courseId: string): Promise<CourseFacts | null> {
    const c = await this.db.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        owner: { select: { firstName: true, lastName: true } },
        workspace: { select: { name: true } },
      },
    });
    if (!c) return null;
    return {
      id: c.id,
      title: c.title,
      teacherName: `${c.owner.firstName} ${c.owner.lastName}`.trim(),
      workspaceName: c.workspace.name,
    };
  }

  /** Sends `template` to every recipient not in `sentTo` (updated and saved after each send). */
  private async sendAll(
    job: Job,
    template: 'course.assigned' | 'course.published',
    course: CourseFacts,
    recipients: Recipient[],
    sentTo: string[],
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const r of recipients) {
      if (sentTo.includes(r.key)) continue;
      try {
        await this.email.send({
          to: r.to,
          locale: r.locale,
          templateKey: template,
          params: {
            firstName: r.firstName,
            courseTitle: course.title,
            teacherName: course.teacherName,
            workspaceName: course.workspaceName,
            link: studentCourseLink(this.env.WEB_ORIGIN, r.locale, course.id),
          },
        });
      } catch (err) {
        failed += 1;
        this.logger.error(
          { courseId: course.id, userId: r.userId, templateKey: template, err: errType(err) },
          'course email not sent',
        );
        continue;
      }
      sent += 1;
      sentTo.push(r.key);
      await this.saveSentTo(job, sentTo);
    }
    return { sent, failed };
  }

  private async finish(
    job: Job,
    sentTo: string[],
    sent: number,
    failed: number,
    meta: Record<string, string>,
  ): Promise<CourseNotifyResult> {
    if (failed > 0) {
      await this.saveSentTo(job, sentTo);
      throw new Error(`course notifications: ${failed} email(s) not sent`);
    }
    this.logger.info({ ...meta, sent }, 'course notifications sent');
    return { sent };
  }

  /** A failed progress write is logged, never thrown (the email it records was sent). */
  private async saveSentTo(job: Job, sentTo: string[]): Promise<void> {
    try {
      await job.updateProgress({ sentTo: [...sentTo] });
    } catch (err) {
      this.logger.warn(
        { jobName: job.name, recipients: sentTo.length, err: errType(err) },
        'course notification progress not saved',
      );
    }
  }
}
