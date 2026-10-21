import { z } from 'zod';
import { IMPORT_MAX_BYTES, IMPORT_ROW_OUTCOMES, IMPORT_STATUSES } from './invite-constants';

/**
 * `POST /workspaces/{wid}/invitations/import?dryRun` (`student.invite`, verified teacher): the CSV
 * file as text (UTF-8, optional BOM). Larger than `IMPORT_MAX_BYTES` → refused here; more than
 * `IMPORT_MAX_ROWS` rows → `413 IMPORT_TOO_LARGE` (service).
 */
export const ImportRequestSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    content: z.string().max(IMPORT_MAX_BYTES),
  })
  .strict();

export type ImportRequestInput = z.infer<typeof ImportRequestSchema>;

/**
 * `dryRun=true` returns the preview without creating anything. Only `'true'` / `'false'` are
 * accepted (a plain `z.coerce.boolean()` would read `'false'` as `true`).
 */
export const ImportQuerySchema = z.object({
  dryRun: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type ImportQuery = z.infer<typeof ImportQuerySchema>;

/** One CSV line and its outcome (`line` counts from 2: the header is line 1). */
export const ImportRowSchema = z.object({
  line: z.number().int(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  guardianEmail: z.string().nullable(),
  birthDate: z.string().nullable(),
  courseCodes: z.array(z.string()),
  outcome: z.enum(IMPORT_ROW_OUTCOMES),
  message: z.string().optional(),
});

export type ImportRow = z.infer<typeof ImportRowSchema>;

/** `200` of a dry run: every line with its outcome. */
export const ImportPreviewSchema = z.object({
  totalRows: z.number().int(),
  validRows: z.number().int(),
  rows: z.array(ImportRowSchema),
});

export type ImportPreview = z.infer<typeof ImportPreviewSchema>;

/** `GET …/invitations/import/{importId}`: progress and the report so far. */
export const ImportStatusSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  status: z.enum(IMPORT_STATUSES),
  totalRows: z.number().int(),
  validRows: z.number().int(),
  processedRows: z.number().int(),
  createdCount: z.number().int(),
  failedCount: z.number().int(),
  report: z.array(ImportRowSchema),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type InvitationImportStatus = z.infer<typeof ImportStatusSchema>;

/** `202` of a confirmed import: the job is queued. */
export const ImportAcceptedSchema = z.object({ importId: z.string() });

export type ImportAccepted = z.infer<typeof ImportAcceptedSchema>;
