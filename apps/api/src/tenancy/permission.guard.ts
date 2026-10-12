import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@tt/contracts';
import { RequestContext } from '../common/request-context';
import { REQUIRE_PERMISSION_KEY } from './decorators';
import { currentGrant, permissionDenied } from './permissions';

/**
 * Global guard #4 (after `WorkspaceContextGuard`). Does nothing unless the route (method, else
 * class) is `@RequirePermission(p)`; then evaluates PRD §7 for the caller's membership
 * (`grantFor`): `none` → `403 PERMISSION_DENIED`; `own`/`all` → `RequestContext.permissionScope`,
 * which services honour through `assertOwn`. A `@RequirePermission` route without a workspace
 * context (no `:wid`) is a wiring bug and fails closed with a 500.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) return true;

    const store = RequestContext.get();
    if (!store?.workspace || !store.membership) {
      throw new Error(
        `@RequirePermission('${permission}') on a route without a workspace context (:wid)`,
      );
    }
    const grant = currentGrant(permission);
    if (grant === 'none') throw permissionDenied();
    store.permissionScope = grant;
    return true;
  }
}
