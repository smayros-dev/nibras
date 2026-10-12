import { HttpStatus } from '@nestjs/common';
import { grantFor, type Grant, type Permission } from '@tt/contracts';
import { ApiError } from '../common/api-error';
import { RequestContext } from '../common/request-context';

/**
 * What the current request's membership (set by `WorkspaceContextGuard`) grants for `p`; `none`
 * when there is no workspace context.
 */
export function currentGrant(p: Permission): Grant {
  const store = RequestContext.get();
  const { workspace, membership } = store ?? {};
  if (!workspace || !membership) return 'none';
  return grantFor(
    { role: membership.role, canTeach: membership.canTeach, workspaceType: workspace.type },
    p,
  );
}

export function permissionDenied(): ApiError {
  return new ApiError(HttpStatus.FORBIDDEN, 'PERMISSION_DENIED', 'Permission denied');
}

/**
 * Row-level half of a 🔒 cell: when the route's permission was granted with scope `own`, the
 * resource must belong to the caller (`ownerUserId` = course owner, assigned teacher, session
 * host…), else `403 PERMISSION_DENIED`. Scope `all` passes. Fails closed: without a scope (the
 * route has no `@RequirePermission`) the resource must be the caller's too.
 */
export function assertOwn(ownerUserId: string | null | undefined): void {
  const store = RequestContext.get();
  if (store?.permissionScope === 'all') return;
  const userId = store?.user?.id;
  if (!userId || !ownerUserId || ownerUserId !== userId) throw permissionDenied();
}
