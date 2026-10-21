import { HttpStatus, Injectable } from '@nestjs/common';
import {
  INVITATIONS_IMPORT_JOB,
  QUEUES,
  importJobId,
  type ImportAccepted,
  type ImportPreview,
  type ImportRequestInput,
  type ImportRow,
  type InvitationImportStatus,
  type InvitationsImportJob,
} from '@nibras/contracts';
import {
  Prisma,
  tenantDb,
  withTenantTx,
  type InvitationImport,
  type MembershipStatus,
} from '@nibras/db';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import type { MemberCtx } from '../members/members.service';
import { QueueService } from '../queue/queue.service';
import { lockWorkspace } from '../workspaces/workspace-settings.service';
import { isValidOutcome, outcomeMessage, parseImportCsv, reportCsv } from './csv';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Memberships that are over: their address may be invited again (same rule as invitations). */
const ENDED: MembershipStatus[] = ['REMOVED', 'REJECTED'];
const ACTIVE_IMPORT: InvitationImport['status'][] = ['QUEUED', 'RUNNING'];

/** One row the worker consumes (`InvitationImport.rows`): no outcome, no message. */
export type StoredImportRow = Omit<ImportRow, 'outcome' | 'message'>;
/** One report line (`InvitationImport.report`). */
export type ReportRow = Pick<ImportRow, 'line' | 'email' | 'outcome' | 'message'>;

function notFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}

/** A stored report as `ImportRow`s (the report keeps line, email, outcome and message only). */
function reportRows(report: Prisma.JsonValue): ImportRow[] {
  if (!Array.isArray(report)) return [];
  return report
    .filter((r): r is Prisma.JsonObject => !!r && typeof r === 'object' && !Array.isArray(r))
    .map((r) => {
      const row: ImportRow = {
        line: typeof r.line === 'number' ? r.line : 0,
        email: typeof r.email === 'string' ? r.email : '',
        firstName: null,
        lastName: null,
        guardianEmail: null,
        birthDate: null,
        courseCodes: [],
        outcome: r.outcome as ImportRow['outcome'],
      };
      if (typeof r.message === 'string') row.message = r.message;
      return row;
    })
    .sort((a, b) => a.line - b.line);
}

/**
 * CSV import of student invitations (PRD §8.3.4, AC-INV-07; design §4.5). The API parses and
 * previews; a confirmed import is stored (`InvitationImport`, valid rows only) and handed to the
 * worker (`invitations.import_csv`), which creates and emails the invitations (D10: tokens are
 * generated where the email is sent). Every query runs through `tenantDb(wid)`; scope `own`
 * (organisation TEACHER) sees only the imports he started. Nothing here logs an address.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  /**
   * `POST …/invitations/import?dryRun=true`: every line with its outcome; addresses already
   * members (any status but REMOVED / REJECTED) → `ALREADY_MEMBER`, with a stored `PENDING`
   * invitation → `ALREADY_INVITED`. Writes nothing.
   */
  async preview(ctx: MemberCtx, input: ImportRequestInput): Promise<ImportPreview> {
    const { rows } = parseImportCsv(input.content);
    const checked = await this.checkExisting(ctx.workspaceId, rows);
    return {
      totalRows: checked.length,
      validRows: checked.filter((r) => isValidOutcome(r.outcome)).length,
      rows: checked,
    };
  }

  /**
   * `POST …/invitations/import`: the preview, then (no valid row → `422 IMPORT_NO_VALID_ROWS`)
   * under the workspace row lock, one `QUEUED | RUNNING` import per workspace (else `409
   * IMPORT_IN_PROGRESS`) and the `InvitationImport` with the valid rows and the invalid lines as
   * its initial report. Then the job `{ importId, workspaceId }` (ids only) with the idempotent
   * `jobId` `import:{id}:csv`; an enqueue failure marks the import `FAILED` so it never blocks the
   * workspace. Audits `invitations.import_started`.
   */
  async confirm(ctx: MemberCtx, input: ImportRequestInput): Promise<ImportAccepted> {
    const preview = await this.preview(ctx, input);
    if (preview.validRows === 0) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'IMPORT_NO_VALID_ROWS',
        'The file has no row that can be imported',
      );
    }
    const rows: StoredImportRow[] = [];
    const report: ReportRow[] = [];
    for (const r of preview.rows) {
      if (isValidOutcome(r.outcome)) {
        rows.push({
          line: r.line,
          email: r.email,
          firstName: r.firstName,
          lastName: r.lastName,
          guardianEmail: r.guardianEmail,
          birthDate: r.birthDate,
          courseCodes: r.courseCodes,
        });
      } else {
        report.push({ line: r.line, email: r.email, outcome: r.outcome, message: r.message });
      }
    }

    const created = await withTenantTx(ctx.workspaceId, async (tx) => {
      await lockWorkspace(tx, ctx.workspaceId);
      const running = await tx.invitationImport.findFirst({
        where: { status: { in: ACTIVE_IMPORT } },
        select: { id: true },
      });
      if (running) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'IMPORT_IN_PROGRESS',
          'An import is already running in this workspace',
          { importId: running.id },
        );
      }
      return tx.invitationImport.create({
        data: {
          workspaceId: ctx.workspaceId,
          createdByUserId: ctx.userId,
          fileName: input.fileName,
          status: 'QUEUED',
          rows: rows as unknown as Prisma.InputJsonValue,
          report: report as unknown as Prisma.InputJsonValue,
          totalRows: preview.totalRows,
          validRows: preview.validRows,
        },
        select: { id: true },
      });
    });

    const job: InvitationsImportJob = { importId: created.id, workspaceId: ctx.workspaceId };
    try {
      await this.queue.add(QUEUES.imports, INVITATIONS_IMPORT_JOB, job, {
        jobId: importJobId(created.id),
      });
    } catch (err) {
      await tenantDb(ctx.workspaceId).invitationImport.updateMany({
        where: { id: created.id, status: 'QUEUED' },
        data: { status: 'FAILED', error: 'The import could not be queued', finishedAt: new Date() },
      });
      throw err;
    }
    await this.audit.log({
      action: 'invitations.import_started',
      entityType: 'InvitationImport',
      entityId: created.id,
      after: {
        fileName: input.fileName,
        totalRows: preview.totalRows,
        validRows: preview.validRows,
      },
    });
    return { importId: created.id };
  }

  /** `GET …/invitations/import/{importId}`: progress and the report so far (outside scope → 404). */
  async status(ctx: MemberCtx, id: string): Promise<InvitationImportStatus> {
    const row = await this.find(ctx, id);
    return {
      id: row.id,
      fileName: row.fileName,
      status: row.status,
      totalRows: row.totalRows,
      validRows: row.validRows,
      processedRows: row.processedRows,
      createdCount: row.createdCount,
      failedCount: row.failedCount,
      report: reportRows(row.report),
      error: row.error,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * `GET …/invitations/import/{importId}/report`: the report as a CSV (BOM, `line,email,outcome,
   * message`, formula cells neutralised) and its file name.
   */
  async report(ctx: MemberCtx, id: string): Promise<{ fileName: string; csv: string }> {
    const row = await this.find(ctx, id);
    return { fileName: `import-${row.id}.csv`, csv: reportCsv(reportRows(row.report)) };
  }

  /** `ALREADY_MEMBER` / `ALREADY_INVITED` on the valid rows: one query each. */
  private async checkExisting(wid: string, rows: ImportRow[]): Promise<ImportRow[]> {
    const emails = [...new Set(rows.filter((r) => isValidOutcome(r.outcome)).map((r) => r.email))];
    if (emails.length === 0) return rows;
    const db = tenantDb(wid);
    const [members, pending] = await Promise.all([
      db.membership.findMany({
        where: { status: { notIn: ENDED }, user: { email: { in: emails } } },
        select: { user: { select: { email: true } } },
      }),
      db.invitation.findMany({
        where: { status: 'PENDING', email: { in: emails } },
        select: { email: true },
      }),
    ]);
    const memberEmails = new Set(members.map((m) => m.user.email));
    const pendingEmails = new Set(pending.map((i) => i.email));
    return rows.map((r) => {
      if (!isValidOutcome(r.outcome)) return r;
      const outcome = memberEmails.has(r.email)
        ? 'ALREADY_MEMBER'
        : pendingEmails.has(r.email)
          ? 'ALREADY_INVITED'
          : null;
      return outcome ? { ...r, outcome, message: outcomeMessage(outcome) } : r;
    });
  }

  private async find(ctx: MemberCtx, id: string): Promise<InvitationImport> {
    if (!UUID.test(id)) throw notFound();
    const row = await tenantDb(ctx.workspaceId).invitationImport.findFirst({
      where: { id, ...(ctx.scope === 'own' && { createdByUserId: ctx.userId }) },
    });
    if (!row) throw notFound();
    return row;
  }
}
