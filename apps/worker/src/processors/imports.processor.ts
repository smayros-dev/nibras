import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  INVITATION_TTL_MS,
  INVITATIONS_IMPORT_JOB,
  QUEUES,
  generateOpaqueToken,
  intlTag,
  invitationLink,
  type InvitationsImportJob,
} from '@nibras/contracts';
import { Prisma, type InvitationImport, type Locale, type PrismaClient } from '@nibras/db';
import type { EmailProvider } from '@nibras/providers';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';

import { WORKER_ENV, type WorkerEnv } from '../env';
import { WORKER_LOGGER } from '../logger';
import { EMAIL_PROVIDER } from '../providers';
import { ProcessorRegistry } from '../queues';
import { writeSystemAudit } from '../system-audit';
import { WORKER_DB } from '../worker-db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Memberships that are over: their address may be invited again (the API's rule). */
const ENDED = ['REMOVED', 'REJECTED'] as const;
const RUNNABLE: InvitationImport['status'][] = ['QUEUED', 'RUNNING'];
/** Report message of a row whose invitation exists but whose email failed. */
const EMAIL_FAILED_MESSAGE =
  'Invitation created but the email was not sent: resend it from the pending invitations';
const MESSAGES = {
  ALREADY_MEMBER: 'This address already belongs to a member of the workspace',
  ALREADY_INVITED: 'An invitation is already pending for this address',
} as const;

/** One row of `InvitationImport.rows`, as the API's confirm stored it. */
interface ImportRowData {
  line: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  guardianEmail: string | null;
  birthDate: string | null;
}

interface ReportEntry {
  line: number;
  email: string;
  outcome: 'CREATED' | 'FAILED' | 'ALREADY_MEMBER' | 'ALREADY_INVITED';
  message?: string;
}

export type ImportCsvResult =
  { created: number; failed: number } | { skipped: 'not_found' | 'not_runnable' };

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** The stored rows, defensively (a malformed entry is dropped rather than crashing the job). */
function rowsOf(json: Prisma.JsonValue): ImportRowData[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((r): ImportRowData[] => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return [];
    const email = str(r.email);
    if (typeof r.line !== 'number' || !email) return [];
    return [
      {
        line: r.line,
        email,
        firstName: str(r.firstName),
        lastName: str(r.lastName),
        guardianEmail: str(r.guardianEmail),
        birthDate: str(r.birthDate),
      },
    ];
  });
}

/** Same rendering as the API's invitation emails (`formatMailDate`). */
function formatMailDate(date: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    dateStyle: 'long',
    timeZone,
    calendar: 'gregory',
  }).format(date);
}

/** A unique violation: the pending-invitation-per-address index decided a race. */
const uniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

const errType = (err: unknown) => ({ type: err instanceof Error ? err.name : typeof err });

/**
 * `invitations.import_csv` on `imports` (AC-INV-07; design §4.5, Review Focus 5), enqueued by the
 * API's confirm with `{ importId, workspaceId }` (ids only) and `jobId = import:{id}:csv`.
 *
 * Per row, from `processedRows`: a live membership of the address → `ALREADY_MEMBER`; a stored
 * `PENDING` invitation → `ALREADY_INVITED`; else the invitation is created (token generated here,
 * only its hash stored; 7 days; the importer as inviter; an organisation TEACHER importer as the
 * student's teacher) and `invitation.received_student` is sent with the link. The row's outcome,
 * the counters and `processedRows` are persisted after every row (and `job.updateProgress`), so a
 * retry resumes at the first unprocessed row; a row whose invitation was created just before a
 * crash is found pending and reported `ALREADY_INVITED` — no address is ever emailed twice.
 *
 * Two failure modes are kept apart: an email failure marks that row `FAILED` (the invitation
 * exists, « Renvoyer » sends it again) and the job goes on; any other error (database) fails the
 * job and BullMQ retries it; on the last attempt the import is marked `FAILED` first.
 *
 * The worker's client bypasses RLS: every query filters on the import's `workspaceId`. Logs carry
 * identifiers only, never an address or a token.
 */
@Injectable()
export class ImportsProcessor implements OnModuleInit {
  constructor(
    private readonly registry: ProcessorRegistry,
    @Inject(WORKER_DB) private readonly db: PrismaClient,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.registry.registerProcessor(QUEUES.imports, INVITATIONS_IMPORT_JOB, (job) =>
      this.importCsv(job as Job<InvitationsImportJob>),
    );
  }

  async importCsv(job: Job<InvitationsImportJob>): Promise<ImportCsvResult> {
    const { importId, workspaceId } = job.data ?? ({} as Partial<InvitationsImportJob>);
    if (
      typeof importId !== 'string' ||
      typeof workspaceId !== 'string' ||
      !UUID.test(importId) ||
      !UUID.test(workspaceId)
    ) {
      return { skipped: 'not_found' };
    }
    const imp = await this.db.invitationImport.findFirst({ where: { id: importId, workspaceId } });
    if (!imp) return { skipped: 'not_found' };
    if (!RUNNABLE.includes(imp.status)) return { skipped: 'not_runnable' };

    try {
      return await this.run(job, imp);
    } catch (err) {
      const attempts = job.opts?.attempts ?? 1;
      if (job.attemptsMade + 1 >= attempts) {
        await this.db.invitationImport.updateMany({
          where: { id: imp.id, workspaceId, status: { in: RUNNABLE } },
          data: {
            status: 'FAILED',
            error: `Import stopped after ${attempts} attempt(s) (${errType(err).type})`,
            finishedAt: new Date(),
          },
        });
        this.logger.error(
          { workspace_id: workspaceId, importId, err: errType(err) },
          'csv import failed',
        );
      }
      throw err;
    }
  }

  private async run(job: Job, imp: InvitationImport): Promise<ImportCsvResult> {
    const { workspaceId } = imp;
    const jobId = String(job.id);
    await this.db.invitationImport.updateMany({
      where: { id: imp.id, workspaceId, status: { in: RUNNABLE } },
      data: { status: 'RUNNING', startedAt: imp.startedAt ?? new Date() },
    });
    const [workspace, importer, importerMembership] = await Promise.all([
      this.db.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { id: true, type: true, name: true, defaultLocale: true, defaultTimezone: true },
      }),
      this.db.user.findUniqueOrThrow({
        where: { id: imp.createdByUserId },
        select: { id: true, email: true, firstName: true, lastName: true, locale: true },
      }),
      this.db.membership.findFirst({
        where: { workspaceId, userId: imp.createdByUserId },
        select: { role: true },
      }),
    ]);
    // `studentTeacherFor` (API): an organisation TEACHER is the implicit teacher; OWNER / ADMIN
    // invitations name nobody unless they choose one (the CSV has no teacher column).
    const teacherUserId =
      workspace.type === 'ORGANIZATION' && importerMembership?.role === 'TEACHER'
        ? importer.id
        : null;
    const inviterName = `${importer.firstName} ${importer.lastName}`.trim();
    const rows = rowsOf(imp.rows);
    const report = (Array.isArray(imp.report) ? imp.report : []) as unknown as ReportEntry[];
    let { processedRows, createdCount, failedCount } = imp;
    this.logger.info(
      { workspace_id: workspaceId, importId: imp.id, from: processedRows, rows: rows.length },
      'csv import started',
    );

    for (let i = processedRows; i < rows.length; i += 1) {
      const row = rows[i]!;
      const entry = await this.importRow(row, imp, teacherUserId, inviterName, workspace);
      if (entry.outcome === 'CREATED' || entry.outcome === 'FAILED') createdCount += 1;
      if (entry.outcome === 'FAILED') failedCount += 1;
      report.push(entry);
      processedRows = i + 1;
      await this.db.invitationImport.updateMany({
        where: { id: imp.id, workspaceId },
        data: {
          processedRows,
          createdCount,
          failedCount,
          report: report as unknown as Prisma.InputJsonValue,
        },
      });
      await this.saveProgress(job, processedRows, imp);
    }

    const finishedAt = new Date();
    await this.db.invitationImport.updateMany({
      where: { id: imp.id, workspaceId, status: 'RUNNING' },
      data: { status: 'COMPLETED', finishedAt },
    });
    await writeSystemAudit(
      this.db,
      {
        workspaceId,
        action: 'invitations.import_completed',
        entityType: 'InvitationImport',
        entityId: imp.id,
        after: {
          fileName: imp.fileName,
          totalRows: imp.totalRows,
          validRows: imp.validRows,
          processedRows,
          createdCount,
          failedCount,
        },
      },
      jobId,
      this.logger,
    );
    const origin = this.env.WEB_ORIGIN.replace(/\/+$/, '');
    try {
      await this.email.send({
        to: importer.email,
        templateKey: 'imports.completed',
        locale: importer.locale,
        params: {
          firstName: importer.firstName,
          workspaceName: workspace.name,
          created: createdCount,
          failed: failedCount,
          link: `${origin}/${importer.locale}/app/w/${workspaceId}/students`,
        },
      });
    } catch (err) {
      this.logger.error(
        { workspace_id: workspaceId, importId: imp.id, userId: importer.id, err: errType(err) },
        'csv import summary email not sent',
      );
    }
    this.logger.info(
      { workspace_id: workspaceId, importId: imp.id, processedRows, createdCount, failedCount },
      'csv import completed',
    );
    return { created: createdCount, failed: failedCount };
  }

  /**
   * One row: the membership / pending checks, the invitation (the partial unique index on the
   * pending address settles a race with the API as `ALREADY_INVITED`), then the email. Only an
   * email failure is caught here.
   */
  private async importRow(
    row: ImportRowData,
    imp: InvitationImport,
    teacherUserId: string | null,
    inviterName: string,
    workspace: { name: string; defaultLocale: Locale; defaultTimezone: string },
  ): Promise<ReportEntry> {
    const { workspaceId } = imp;
    const base = { line: row.line, email: row.email };
    const member = await this.db.membership.findFirst({
      where: { workspaceId, status: { notIn: [...ENDED] }, user: { email: row.email } },
      select: { id: true },
    });
    if (member) {
      return { ...base, outcome: 'ALREADY_MEMBER', message: MESSAGES.ALREADY_MEMBER };
    }
    const pending = await this.db.invitation.findFirst({
      where: { workspaceId, email: row.email, status: 'PENDING' },
      select: { id: true },
    });
    if (pending) {
      return { ...base, outcome: 'ALREADY_INVITED', message: MESSAGES.ALREADY_INVITED };
    }

    const { raw, hash } = generateOpaqueToken();
    const now = new Date();
    let invitation: { id: string; expiresAt: Date };
    try {
      invitation = await this.db.invitation.create({
        data: {
          workspaceId,
          email: row.email,
          role: 'STUDENT',
          firstName: row.firstName,
          lastName: row.lastName,
          guardianEmail: row.guardianEmail,
          birthDate: row.birthDate ? new Date(`${row.birthDate}T00:00:00.000Z`) : null,
          tokenHash: hash,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
          status: 'PENDING',
          invitedByUserId: imp.createdByUserId,
          teacherUserId,
          lastSentAt: now,
        },
        select: { id: true, expiresAt: true },
      });
    } catch (err) {
      if (uniqueViolation(err)) {
        return { ...base, outcome: 'ALREADY_INVITED', message: MESSAGES.ALREADY_INVITED };
      }
      throw err;
    }

    // The invitee's locale: his account's when one exists for the address, else the workspace's.
    const account = await this.db.user.findUnique({
      where: { email: row.email },
      select: { locale: true },
    });
    const locale = account?.locale ?? workspace.defaultLocale;
    try {
      await this.email.send({
        to: row.email,
        templateKey: 'invitation.received_student',
        locale,
        params: {
          hasName: row.firstName ? 'yes' : 'no',
          firstName: row.firstName ?? '',
          inviterName,
          workspaceName: workspace.name,
          hasMessage: 'no',
          message: '',
          link: invitationLink(this.env.WEB_ORIGIN, locale, raw),
          expiresAt: formatMailDate(invitation.expiresAt, locale, workspace.defaultTimezone),
        },
      });
    } catch (err) {
      this.logger.error(
        {
          workspace_id: workspaceId,
          importId: imp.id,
          invitationId: invitation.id,
          line: row.line,
          err: errType(err),
        },
        'import invitation email not sent',
      );
      return { ...base, outcome: 'FAILED', message: EMAIL_FAILED_MESSAGE };
    }
    return { ...base, outcome: 'CREATED' };
  }

  /** BullMQ progress = processed rows; a failed write is logged and never fails the job. */
  private async saveProgress(job: Job, processedRows: number, imp: InvitationImport) {
    try {
      await job.updateProgress(processedRows);
    } catch (err) {
      this.logger.warn(
        { workspace_id: imp.workspaceId, importId: imp.id, err: errType(err) },
        'csv import progress not saved',
      );
    }
  }
}
