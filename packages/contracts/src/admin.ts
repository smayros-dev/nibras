import { z } from 'zod';
import {
  ADMIN_WORKSPACES_PAGE_DEFAULT,
  ADMIN_WORKSPACES_PAGE_MAX,
  MAX_STORAGE_QUOTA_BYTES,
  SUSPENSION_REASON_MAX,
  WORKSPACE_STATUSES,
} from './admin-constants';
import { QUEUES } from './queues';
import { WORKSPACE_TYPES } from './permissions';

export * from './admin-constants';

const DECIMAL = /^\d{1,20}$/;

/**
 * `GET /admin/workspaces` (super-admin): every workspace of the platform, newest first
 * (`createdAt` desc, then `id` desc). `type`/`status` are exact filters; `q` matches the name or
 * the slug (case-insensitive substring); `cursor` = the previous page's `nextCursor`.
 */
export const AdminWorkspacesQuerySchema = z.object({
  type: z.enum(WORKSPACE_TYPES).optional(),
  status: z.enum(WORKSPACE_STATUSES).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ADMIN_WORKSPACES_PAGE_MAX)
    .default(ADMIN_WORKSPACES_PAGE_DEFAULT),
});

export type AdminWorkspacesQuery = z.infer<typeof AdminWorkspacesQuerySchema>;

/**
 * A workspace in the admin console. `memberCount`: ACTIVE memberships. Byte counts are decimal
 * strings (beyond 2^53).
 */
export const AdminWorkspaceSchema = z.object({
  id: z.string(),
  type: z.enum(WORKSPACE_TYPES),
  name: z.string(),
  slug: z.string(),
  status: z.enum(WORKSPACE_STATUSES),
  suspendedReason: z.string().nullable(),
  memberCount: z.number().int(),
  storageUsedBytes: z.string(),
  storageQuotaBytes: z.string(),
  createdAt: z.string(),
});

export type AdminWorkspace = z.infer<typeof AdminWorkspaceSchema>;

export const AdminWorkspacesPageSchema = z.object({
  items: z.array(AdminWorkspaceSchema),
  nextCursor: z.string().nullable(),
});

export type AdminWorkspacesPage = z.infer<typeof AdminWorkspacesPageSchema>;

/**
 * `POST /admin/workspaces/{wid}/suspend` and `POST /admin/users/{uid}/suspend`: the reason is
 * stored (`suspendedReason`), shown to the members of a suspended workspace and sent to a
 * suspended user.
 */
export const SuspensionSchema = z
  .object({ reason: z.string().trim().min(1).max(SUSPENSION_REASON_MAX) })
  .strict();

export type SuspensionInput = z.infer<typeof SuspensionSchema>;

/**
 * `PATCH /admin/workspaces/{wid}/quota`: a non-negative integer of bytes, as a JSON integer or a
 * decimal string (bigint-safe), at most {@link MAX_STORAGE_QUOTA_BYTES}. Below the workspace's
 * current `storageUsedBytes` → `422 VALIDATION_FAILED` (checked by the service).
 */
export const UpdateWorkspaceQuotaSchema = z
  .object({
    storageQuotaBytes: z.union([
      z.number().int().min(0).max(MAX_STORAGE_QUOTA_BYTES),
      z
        .string()
        .regex(DECIMAL, 'Expected a decimal integer')
        // zod still runs refinements after a failed regex: re-check before BigInt() can throw.
        .refine((v) => DECIMAL.test(v) && BigInt(v) <= BigInt(MAX_STORAGE_QUOTA_BYTES), {
          message: `At most ${MAX_STORAGE_QUOTA_BYTES} bytes`,
        }),
    ]),
  })
  .strict();

export type UpdateWorkspaceQuotaInput = z.infer<typeof UpdateWorkspaceQuotaSchema>;

const ProbeStatusSchema = z.enum(['up', 'down']);

/**
 * One BullMQ queue of `QUEUES` (`Queue.getJobCounts`). The counts are `null` when Redis did not
 * answer.
 */
export const AdminQueueHealthSchema = z.object({
  name: z.enum(Object.values(QUEUES) as [string, ...string[]]),
  waiting: z.number().int().nullable(),
  active: z.number().int().nullable(),
  delayed: z.number().int().nullable(),
  failed: z.number().int().nullable(),
});

export type AdminQueueHealth = z.infer<typeof AdminQueueHealthSchema>;

/** `GET /admin/health` (US-X02): database, Redis and every queue of `QUEUES`, in that order. */
export const AdminHealthSchema = z.object({
  db: ProbeStatusSchema,
  redis: ProbeStatusSchema,
  queues: z.array(AdminQueueHealthSchema),
});

export type AdminHealth = z.infer<typeof AdminHealthSchema>;
