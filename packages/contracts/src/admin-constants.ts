// Zod-free (exported by `@tt/contracts/web` for browser bundles); the schemas are in admin.ts.
/** PRD §11.2 `WorkspaceStatus`. */
export const WORKSPACE_STATUSES = ['ACTIVE', 'SUSPENDED', 'DELETING'] as const;

/**
 * `Workspace.suspendedReason` of a PERSONAL workspace suspended because its owner was
 * (AC-SAFE-04); reactivating the owner reactivates exactly these workspaces.
 */
export const OWNER_SUSPENDED_REASON = 'OWNER_SUSPENDED';

/** Upper bound of `PATCH /admin/workspaces/{wid}/quota` (10 TiB; below 2^53, safe as a number). */
export const MAX_STORAGE_QUOTA_BYTES = 10 * 1024 ** 4;

export const ADMIN_WORKSPACES_PAGE_MAX = 100;
export const ADMIN_WORKSPACES_PAGE_DEFAULT = 50;
export const SUSPENSION_REASON_MAX = 1000;
