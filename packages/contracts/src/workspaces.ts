import { z } from 'zod';
import { TimezoneSchema } from './auth';
import { LocaleSchema } from './locale';
import { MEMBERSHIP_ROLES, WORKSPACE_TYPES } from './permissions';

const WorkspaceNameSchema = z.string().trim().min(1).max(120);

/** ISO 3166-1 alpha-2 country code, stored upper-case (`ma` → `MA`). */
export const CountryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'Expected an ISO 3166-1 alpha-2 country code')
  .transform((c) => c.toUpperCase());

/**
 * `POST /workspaces`: creates an ORGANIZATION (PRD §8.2.2) whose caller becomes `OWNER`;
 * `timezone` is the workspace default time zone and the settings' `default_timezone`.
 */
export const CreateOrganizationSchema = z
  .object({
    name: WorkspaceNameSchema,
    country: CountryCodeSchema.optional(),
    timezone: TimezoneSchema,
  })
  .strict();

export type CreateOrganizationInput = z.infer<typeof CreateOrganizationSchema>;

/**
 * `PATCH /workspaces/{wid}` (`workspace.settings.update`): any subset of these keys, unknown keys
 * refused. `country: null` clears it. `allowPersonalWorkspaces` exists on an ORGANIZATION only
 * (D-O7): on a PERSONAL workspace it is `422 VALIDATION_FAILED`. `defaultTimezone` also updates
 * the settings' `default_timezone`.
 */
export const UpdateWorkspaceSchema = z
  .object({
    name: WorkspaceNameSchema.optional(),
    country: CountryCodeSchema.nullable().optional(),
    defaultTimezone: TimezoneSchema.optional(),
    defaultLocale: LocaleSchema.optional(),
    allowPersonalWorkspaces: z.boolean().optional(),
  })
  .strict();

export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceSchema>;

/**
 * A workspace as its members see it (`GET /workspaces/{wid}`, and the `201` of
 * `POST /workspaces` / `POST /me/personal-workspace`), with the caller's role there.
 */
export const WorkspaceDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  type: z.enum(WORKSPACE_TYPES),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETING']),
  country: z.string().nullable(),
  defaultTimezone: z.string(),
  defaultLocale: LocaleSchema,
  allowPersonalWorkspaces: z.boolean(),
  createdAt: z.string(),
  myRole: z.enum(MEMBERSHIP_ROLES),
  myCanTeach: z.boolean(),
});

export type WorkspaceDetail = z.infer<typeof WorkspaceDetailSchema>;

/** `GET /workspaces/{wid}/storage`: byte counts as decimal strings (beyond 2^53). */
export const WorkspaceStorageSchema = z.object({
  quotaBytes: z.string(),
  usedBytes: z.string(),
  /** SP3: declared sizes of the `UPLOADING` assets (spec D17), counted against the quota. */
  reservedBytes: z.string(),
});

export type WorkspaceStorage = z.infer<typeof WorkspaceStorageSchema>;

/**
 * `POST /workspaces/{wid}/transfer-ownership` (`workspace.transfer`, OWNER only): the target must
 * hold an ACTIVE `ADMIN` membership of the workspace, else `422 VALIDATION_FAILED`; a PERSONAL
 * workspace is `409 NOT_AN_ORGANIZATION`.
 */
export const TransferOwnershipSchema = z.object({ toUserId: z.uuid() }).strict();

export type TransferOwnershipInput = z.infer<typeof TransferOwnershipSchema>;

export const AUDIT_LOG_PAGE_MAX = 100;
export const AUDIT_LOG_PAGE_DEFAULT = 50;

/**
 * `GET /workspaces/{wid}/audit-log` query: `action` (exact), `actorUserId`, `from`/`to` (ISO
 * date-times, inclusive), `cursor` (the `nextCursor` of the previous page) and `limit` (1–100,
 * default 50). Other query parameters are ignored: the workspace is always the path's.
 */
export const AuditLogQuerySchema = z.object({
  action: z.string().trim().min(1).max(100).optional(),
  actorUserId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_LOG_PAGE_MAX).default(AUDIT_LOG_PAGE_DEFAULT),
});

export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

/** One `AuditLog` row of the workspace. Dates are ISO strings. */
export const AuditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  actorUserId: z.string().nullable(),
  actorRole: z.string(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string(),
  createdAt: z.string(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/** Newest first (`createdAt` desc, then `id` desc); `nextCursor` is `null` on the last page. */
export const AuditLogPageSchema = z.object({
  items: z.array(AuditEntrySchema),
  nextCursor: z.string().nullable(),
});

export type AuditLogPage = z.infer<typeof AuditLogPageSchema>;
