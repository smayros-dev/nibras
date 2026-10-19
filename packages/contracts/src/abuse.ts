import { z } from 'zod';
import {
  ABUSE_CATEGORIES,
  ABUSE_REPORT_STATUSES,
  ABUSE_ENTITY_TYPES,
  ABUSE_DESCRIPTION_MIN,
  ABUSE_DESCRIPTION_MAX,
  ABUSE_ATTACHMENTS_MAX,
} from './abuse-constants';
import type { Locale } from './locale-codes';

export * from './abuse-constants';

/**
 * Where a handler opens a report: `admin` (super-admin console) always, `workspace` (the
 * organisation's own queue) when the report belongs to a workspace. `origin` is the web origin
 * (`WEB_ORIGIN`); trailing slashes are ignored.
 */
export function abuseReportLinks(
  origin: string,
  locale: Locale,
  workspaceId: string | null,
  id: string,
): { admin: string; workspace: string | null } {
  const base = `${origin.replace(/\/+$/, '')}/${locale}`;
  return {
    admin: `${base}/admin/abuse-reports/${id}`,
    workspace: workspaceId === null ? null : `${base}/app/w/${workspaceId}/abuse-reports/${id}`,
  };
}

/**
 * `POST /workspaces/{wid}/abuse-reports` (`abuse.report`, any member) and `POST /abuse-reports`
 * (any signed-in user, outside a workspace: `entityType` must be `USER`, else `422
 * ENTITY_TYPE_UNSUPPORTED`). An entity type without a registered snapshot provider → `422
 * ENTITY_TYPE_UNSUPPORTED`; an entity the provider cannot find (in that workspace) → `404`.
 * `attachments`: media asset ids (SP3), at most 10.
 */
export const CreateAbuseReportSchema = z
  .object({
    category: z.enum(ABUSE_CATEGORIES),
    description: z.string().trim().min(ABUSE_DESCRIPTION_MIN).max(ABUSE_DESCRIPTION_MAX),
    entityType: z.enum(ABUSE_ENTITY_TYPES),
    entityId: z.uuid(),
    attachments: z.array(z.uuid()).max(ABUSE_ATTACHMENTS_MAX).optional(),
  })
  .strict();

export type CreateAbuseReportInput = z.infer<typeof CreateAbuseReportSchema>;

/** `201` of both creation routes. */
export const AbuseReportCreatedSchema = z.object({
  id: z.string(),
  status: z.enum(ABUSE_REPORT_STATUSES),
});

export type AbuseReportCreated = z.infer<typeof AbuseReportCreatedSchema>;

export const ABUSE_REPORTS_PAGE_MAX = 100;
export const ABUSE_REPORTS_PAGE_DEFAULT = 50;

const pageFields = {
  cursor: z.uuid().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ABUSE_REPORTS_PAGE_MAX)
    .default(ABUSE_REPORTS_PAGE_DEFAULT),
};

/**
 * `GET /me/abuse-reports`: the caller's own reports, newest first (`createdAt` desc, then `id`
 * desc); `cursor` = the previous page's `nextCursor`.
 */
export const MyAbuseReportsQuerySchema = z.object(pageFields);

export type MyAbuseReportsQuery = z.infer<typeof MyAbuseReportsQuerySchema>;

/** One of the caller's reports: no snapshot, no description, nothing about the handling. */
export const MyAbuseReportSchema = z.object({
  id: z.string(),
  category: z.enum(ABUSE_CATEGORIES),
  status: z.enum(ABUSE_REPORT_STATUSES),
  entityType: z.enum(ABUSE_ENTITY_TYPES),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});

export type MyAbuseReport = z.infer<typeof MyAbuseReportSchema>;

export const MyAbuseReportsPageSchema = z.object({
  items: z.array(MyAbuseReportSchema),
  nextCursor: z.string().nullable(),
});

export type MyAbuseReportsPage = z.infer<typeof MyAbuseReportsPageSchema>;

/**
 * `GET /workspaces/{wid}/abuse-reports` (`abuse.handle`): the workspace's reports, newest first;
 * `status`/`category` are exact filters.
 */
export const AbuseReportsQuerySchema = z.object({
  status: z.enum(ABUSE_REPORT_STATUSES).optional(),
  category: z.enum(ABUSE_CATEGORIES).optional(),
  ...pageFields,
});

export type AbuseReportsQuery = z.infer<typeof AbuseReportsQuerySchema>;

/**
 * `GET /admin/abuse-reports` (super-admin): every report of the platform (organisations,
 * personal workspaces, outside any workspace), newest first. `workspaceId` narrows to one
 * workspace. MINOR_SAFETY reports are listed whatever an organisation did with them (AC-SAFE-05).
 */
export const AdminAbuseReportsQuerySchema = AbuseReportsQuerySchema.extend({
  workspaceId: z.uuid().optional(),
});

export type AdminAbuseReportsQuery = z.infer<typeof AdminAbuseReportsQuerySchema>;

/** Who filed a report: shown in the super-admin console only (AC-SAFE-02, owner Q1). */
export const AbuseReporterSchema = z.object({
  userId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
});

export type AbuseReporter = z.infer<typeof AbuseReporterSchema>;

/**
 * A report as an organisation handler sees it — never the reporter (AC-SAFE-02, owner Q1): the
 * key does not exist (not `null`). Dates are ISO strings.
 */
export const AbuseReportSchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  category: z.enum(ABUSE_CATEGORIES),
  description: z.string(),
  status: z.enum(ABUSE_REPORT_STATUSES),
  entityType: z.enum(ABUSE_ENTITY_TYPES),
  entityId: z.string(),
  /** Frozen copy of the entity at report time (shape per entity type). */
  contextSnapshot: z.record(z.string(), z.unknown()),
  attachments: z.array(z.string()),
  assignedToUserId: z.string().nullable(),
  resolution: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AbuseReport = z.infer<typeof AbuseReportSchema>;

export const AbuseReportsPageSchema = z.object({
  items: z.array(AbuseReportSchema),
  nextCursor: z.string().nullable(),
});

export type AbuseReportsPage = z.infer<typeof AbuseReportsPageSchema>;

/** A report as the super-admin console sees it (`/admin/abuse-reports`): with its reporter. */
export const AdminAbuseReportSchema = AbuseReportSchema.extend({ reporter: AbuseReporterSchema });

export type AdminAbuseReport = z.infer<typeof AdminAbuseReportSchema>;

export const AdminAbuseReportsPageSchema = z.object({
  items: z.array(AdminAbuseReportSchema),
  nextCursor: z.string().nullable(),
});

export type AdminAbuseReportsPage = z.infer<typeof AdminAbuseReportsPageSchema>;

/**
 * `PATCH /workspaces/{wid}/abuse-reports/{id}` (`abuse.handle`) and `PATCH
 * /admin/abuse-reports/{id}` (super-admin). `RESOLVED`/`DISMISSED` set `resolvedAt`, going back
 * to `OPEN`/`IN_REVIEW` clears it. `assignedToUserId` (`null` unassigns) must be an ACTIVE
 * OWNER/ADMIN of the report's workspace or (admin route only) a super-admin, else `422
 * VALIDATION_FAILED`. `resolution`: `null` clears it.
 */
export const UpdateAbuseReportSchema = z
  .object({
    status: z.enum(ABUSE_REPORT_STATUSES).optional(),
    resolution: z.string().trim().min(1).max(ABUSE_DESCRIPTION_MAX).nullable().optional(),
    assignedToUserId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine(
    (v) => v.status !== undefined || v.resolution !== undefined || v.assignedToUserId !== undefined,
    { message: 'Expected status, resolution or assignedToUserId' },
  );

export type UpdateAbuseReportInput = z.infer<typeof UpdateAbuseReportSchema>;
