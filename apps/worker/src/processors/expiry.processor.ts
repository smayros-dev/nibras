import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { GUARDIAN_CONSENT_EXPIRE_JOB, INVITATION_EXPIRE_JOB, QUEUES } from '@nibras/contracts';
import type { GuardianLink, PrismaClient, User } from '@nibras/db';
import type { EmailProvider } from '@nibras/providers';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';

import { WORKER_ENV, type WorkerEnv } from '../env';
import { WORKER_LOGGER } from '../logger';
import { EMAIL_PROVIDER } from '../providers';
import { ProcessorRegistry } from '../queues';
import { writeSystemAudit } from '../system-audit';
import { WORKER_DB } from '../worker-db';

/** Rows read per query by the expiry jobs. */
export const EXPIRY_BATCH_SIZE = 500;

/** Recipients (user ids) of one expired link still to be emailed by a retry. */
interface UnsentNotice {
  linkId: string;
  userIds: string[];
}

/**
 * `guardian_consent.expire` progress, so a retry resumes after `lastId` and only re-sends the
 * notices that failed (`unsent`). The suspension itself is idempotent: an expired link has no
 * consent token any more and is never selected again.
 */
interface GuardianExpiryProgress {
  processed: number;
  lastId: string | null;
  expired: number;
  notified: number;
  unsent: UnsentNotice[];
}

/** `invitation.expire` progress (`lastId`: the last row looked at). */
interface InvitationExpiryProgress {
  processed: number;
  lastId: string | null;
  expired: number;
}

export interface GuardianConsentExpireResult {
  expired: number;
  notified: number;
}

export interface InvitationExpireResult {
  expired: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) ? v : 0);

function guardianProgress(p: unknown): GuardianExpiryProgress {
  const o = isObject(p) ? p : {};
  const unsent = Array.isArray(o.unsent)
    ? o.unsent.flatMap((u): UnsentNotice[] => {
        if (!isObject(u) || !str(u.linkId) || !Array.isArray(u.userIds)) return [];
        const userIds = u.userIds.filter((x): x is string => typeof x === 'string');
        return userIds.length ? [{ linkId: u.linkId as string, userIds }] : [];
      })
    : [];
  return {
    processed: int(o.processed),
    lastId: str(o.lastId),
    expired: int(o.expired),
    notified: int(o.notified),
    unsent,
  };
}

function invitationProgress(p: unknown): InvitationExpiryProgress {
  const o = isObject(p) ? p : {};
  return { processed: int(o.processed), lastId: str(o.lastId), expired: int(o.expired) };
}

const fullName = (u: Pick<User, 'firstName' | 'lastName'>): string =>
  `${u.firstName} ${u.lastName}`.trim();

const PERSON = { id: true, email: true, firstName: true, lastName: true, locale: true } as const;
type Person = Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'locale'>;

type ExpiringLink = Pick<GuardianLink, 'id' | 'workspaceId' | 'studentUserId' | 'consentExpiresAt'>;

/**
 * The two daily compliance jobs (AC-INV-12), run by BullMQ job schedulers (`Schedulers`).
 *
 * The worker's client bypasses RLS (PRD §13.3): every write filters on the row's `workspaceId`
 * explicitly and every row logs its `workspace_id`. Log lines carry identifiers only, never an
 * address.
 */
@Injectable()
export class ExpiryProcessor implements OnModuleInit {
  constructor(
    private readonly registry: ProcessorRegistry,
    @Inject(WORKER_DB) private readonly db: PrismaClient,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.registry.registerProcessor(QUEUES.compliance, GUARDIAN_CONSENT_EXPIRE_JOB, (job) =>
      this.guardianConsentExpire(job),
    );
    this.registry.registerProcessor(QUEUES.compliance, INVITATION_EXPIRE_JOB, (job) =>
      this.invitationExpire(job),
    );
  }

  /**
   * `guardian_consent.expire`: every `PENDING` guardian link whose 14-day consent link has run out
   * (`consentExpiresAt < now`, token still set; a link recorded before an approval has neither and
   * is skipped). Per link, one transaction: the consent token is cleared (the status stays
   * `PENDING`, so a resend re-arms it, §8.3.5 « relance ») and a `PENDING_GUARDIAN_CONSENT`
   * membership of that workspace becomes `SUSPENDED_NO_CONSENT` (any other status is left alone).
   * Then the `guardian.consent_expired` system audit row and, when the membership was suspended,
   * the `guardian.consent_expired` email to the student and to his teacher (inviter, else the
   * workspace owner). Nothing else is touched: no user row, no consent row, no other membership,
   * no data purged (D-O5).
   *
   * A failed email never stops the run: the other links are processed, the recipient is kept in
   * the progress (`unsent`) and the job fails at the end so BullMQ retries it; the retry re-sends
   * only those notices (while the link is still expired) and resumes after `lastId`.
   */
  async guardianConsentExpire(job: Job): Promise<GuardianConsentExpireResult> {
    const now = new Date();
    const jobId = String(job.id);
    const progress = guardianProgress(job.progress);
    const unsent: UnsentNotice[] = [];

    for (const notice of progress.unsent) {
      const link = await this.db.guardianLink.findUnique({
        where: { id: notice.linkId },
        select: {
          id: true,
          workspaceId: true,
          studentUserId: true,
          status: true,
          consentTokenHash: true,
        },
      });
      // Re-armed (resend) or decided since: the expiry notice is stale.
      if (!link || link.status !== 'PENDING' || link.consentTokenHash !== null) continue;
      const result = await this.notify(link, new Set(notice.userIds));
      progress.notified += result.sent;
      if (result.unsent.length) unsent.push({ linkId: link.id, userIds: result.unsent });
    }
    progress.unsent = unsent;
    await this.saveProgress(job, progress);

    for (;;) {
      const batch: ExpiringLink[] = await this.db.guardianLink.findMany({
        where: {
          status: 'PENDING',
          consentTokenHash: { not: null },
          consentExpiresAt: { lt: now },
          ...(progress.lastId ? { id: { gt: progress.lastId } } : {}),
        },
        orderBy: { id: 'asc' },
        take: EXPIRY_BATCH_SIZE,
        select: { id: true, workspaceId: true, studentUserId: true, consentExpiresAt: true },
      });
      for (const link of batch) {
        const suspended = await this.expireLink(link, now);
        if (suspended !== null) {
          progress.expired += 1;
          this.logger.info(
            {
              workspace_id: link.workspaceId,
              guardianLinkId: link.id,
              membershipSuspended: suspended,
            },
            'guardian consent expired',
          );
          await writeSystemAudit(
            this.db,
            {
              workspaceId: link.workspaceId,
              action: 'guardian.consent_expired',
              entityType: 'GuardianLink',
              entityId: link.id,
              after: {
                studentUserId: link.studentUserId,
                consentExpiresAt: link.consentExpiresAt,
                membershipStatus: suspended ? 'SUSPENDED_NO_CONSENT' : 'UNCHANGED',
              },
            },
            jobId,
            this.logger,
          );
          if (suspended) {
            const result = await this.notify(link, null);
            progress.notified += result.sent;
            if (result.unsent.length) unsent.push({ linkId: link.id, userIds: result.unsent });
          }
        }
        progress.processed += 1;
        progress.lastId = link.id;
        await this.saveProgress(job, progress);
      }
      if (batch.length < EXPIRY_BATCH_SIZE) break;
    }

    if (unsent.length) {
      const count = unsent.reduce((sum, u) => sum + u.userIds.length, 0);
      throw new Error(`guardian consent expiry: ${count} email(s) not sent`);
    }
    this.logger.info(
      { jobId, expired: progress.expired, notified: progress.notified },
      'guardian consent expiry done',
    );
    return { expired: progress.expired, notified: progress.notified };
  }

  /**
   * `invitation.expire`: stored `PENDING` invitations past `expiresAt` → `EXPIRED` (the API
   * already serves them as `EXPIRED`; the stored flip releases the pending-invitation unique
   * index, so the address can be invited again). One conditional update per row (a resend that
   * pushed `expiresAt` meanwhile wins), one `invitation.expired` system audit row each; no email.
   */
  async invitationExpire(job: Job): Promise<InvitationExpireResult> {
    const now = new Date();
    const jobId = String(job.id);
    const progress = invitationProgress(job.progress);

    for (;;) {
      const batch = await this.db.invitation.findMany({
        where: {
          status: 'PENDING',
          expiresAt: { lt: now },
          ...(progress.lastId ? { id: { gt: progress.lastId } } : {}),
        },
        orderBy: { id: 'asc' },
        take: EXPIRY_BATCH_SIZE,
        select: { id: true, workspaceId: true, email: true, role: true, expiresAt: true },
      });
      for (const inv of batch) {
        const { count } = await this.db.invitation.updateMany({
          where: {
            id: inv.id,
            workspaceId: inv.workspaceId,
            status: 'PENDING',
            expiresAt: { lt: now },
          },
          data: { status: 'EXPIRED' },
        });
        if (count === 1) {
          progress.expired += 1;
          this.logger.info(
            { workspace_id: inv.workspaceId, invitationId: inv.id },
            'invitation expired',
          );
          await writeSystemAudit(
            this.db,
            {
              workspaceId: inv.workspaceId,
              action: 'invitation.expired',
              entityType: 'Invitation',
              entityId: inv.id,
              before: { status: 'PENDING' },
              after: {
                status: 'EXPIRED',
                email: inv.email,
                role: inv.role,
                expiresAt: inv.expiresAt,
              },
            },
            jobId,
            this.logger,
          );
        }
        progress.processed += 1;
        progress.lastId = inv.id;
      }
      if (batch.length) await this.saveProgress(job, progress);
      if (batch.length < EXPIRY_BATCH_SIZE) break;
    }

    this.logger.info({ jobId, expired: progress.expired }, 'invitation expiry done');
    return { expired: progress.expired };
  }

  /**
   * Clears the link's consent token and suspends a waiting membership, in one transaction
   * scoped to the link's workspace. `null` when the link is no longer expired-and-pending (a
   * concurrent grant, refusal or resend committed first); else whether the membership was
   * suspended.
   */
  private expireLink(link: ExpiringLink, now: Date): Promise<boolean | null> {
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.guardianLink.updateMany({
        where: {
          id: link.id,
          workspaceId: link.workspaceId,
          status: 'PENDING',
          consentTokenHash: { not: null },
          consentExpiresAt: { lt: now },
        },
        data: { consentTokenHash: null },
      });
      if (count !== 1) return null;
      const suspended = await tx.membership.updateMany({
        where: {
          workspaceId: link.workspaceId,
          userId: link.studentUserId,
          status: 'PENDING_GUARDIAN_CONSENT',
        },
        data: { status: 'SUSPENDED_NO_CONSENT' },
      });
      return suspended.count === 1;
    });
  }

  /**
   * `guardian.consent_expired` to the student (`recipientRole: 'STUDENT'`, link to his home page)
   * and to the teacher (`'TEACHER'`, link to the workspace's students page), each in their own
   * locale; `only` restricts the recipients (a retry). Returns the sent count and the user ids
   * whose email failed.
   */
  private async notify(
    link: Pick<GuardianLink, 'id' | 'workspaceId' | 'studentUserId'>,
    only: ReadonlySet<string> | null,
  ): Promise<{ sent: number; unsent: string[] }> {
    const workspace = await this.db.workspace.findUnique({
      where: { id: link.workspaceId },
      select: { id: true, name: true, ownerUserId: true },
    });
    if (!workspace) return { sent: 0, unsent: [] };
    const membership = await this.db.membership.findFirst({
      where: { workspaceId: link.workspaceId, userId: link.studentUserId },
      select: { invitedByUserId: true },
    });
    const [student, teacher] = await Promise.all([
      this.db.user.findUnique({ where: { id: link.studentUserId }, select: PERSON }),
      this.db.user.findUnique({
        where: { id: membership?.invitedByUserId ?? workspace.ownerUserId },
        select: PERSON,
      }),
    ]);
    if (!student || !teacher) return { sent: 0, unsent: [] };

    const origin = this.env.WEB_ORIGIN.replace(/\/+$/, '');
    const common = {
      studentName: fullName(student),
      workspaceName: workspace.name,
      teacherName: fullName(teacher),
    };
    const messages: { to: Person; role: 'STUDENT' | 'TEACHER'; link: string }[] = [
      { to: student, role: 'STUDENT', link: `${origin}/${student.locale}/app` },
    ];
    if (teacher.id !== student.id) {
      messages.push({
        to: teacher,
        role: 'TEACHER',
        link: `${origin}/${teacher.locale}/app/w/${workspace.id}/students`,
      });
    }

    let sent = 0;
    const unsent: string[] = [];
    for (const m of messages) {
      if (only && !only.has(m.to.id)) continue;
      try {
        await this.email.send({
          to: m.to.email,
          locale: m.to.locale,
          templateKey: 'guardian.consent_expired',
          params: { ...common, firstName: m.to.firstName, recipientRole: m.role, link: m.link },
        });
        sent += 1;
      } catch (err) {
        unsent.push(m.to.id);
        this.logger.error(
          {
            workspace_id: link.workspaceId,
            guardianLinkId: link.id,
            userId: m.to.id,
            recipientRole: m.role,
            err: { type: err instanceof Error ? err.name : typeof err },
          },
          'guardian consent expiry email not sent',
        );
      }
    }
    return { sent, unsent };
  }

  /** Persists the progress; a failure is logged and never fails the job (the work is committed). */
  private async saveProgress(job: Job, progress: object): Promise<void> {
    try {
      await job.updateProgress({ ...progress });
    } catch (err) {
      this.logger.warn(
        {
          jobId: String(job.id),
          jobName: job.name,
          err: { type: err instanceof Error ? err.name : typeof err },
        },
        'expiry progress not saved',
      );
    }
  }
}
