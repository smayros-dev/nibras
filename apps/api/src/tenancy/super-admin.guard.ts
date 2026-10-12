import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '../common/api-error';
import { RequestContext } from '../common/request-context';
import { SUPER_ADMIN_ONLY_KEY } from './decorators';

/**
 * Global guard (after the account gates, so a super-admin has already cleared the mandatory 2FA).
 * Does nothing unless the route (method, else class) is `@SuperAdminOnly()`; then the caller's
 * `platformRole` must be `SUPER_ADMIN`, else `403 PERMISSION_DENIED`.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const only = this.reflector.getAllAndOverride<boolean | undefined>(SUPER_ADMIN_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!only) return true;
    if (RequestContext.get()?.user?.platformRole !== 'SUPER_ADMIN') {
      throw new ApiError(HttpStatus.FORBIDDEN, 'PERMISSION_DENIED', 'Super-admin only');
    }
    return true;
  }
}
