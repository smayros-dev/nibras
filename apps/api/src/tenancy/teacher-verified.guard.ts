import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '../common/api-error';
import { RequestContext } from '../common/request-context';
import { VerificationService } from '../me/verification.service';
import { REQUIRE_VERIFIED_TEACHER_KEY } from './decorators';

/**
 * Global guard, last of the chain (after `AccountGatesGuard`, `WorkspaceContextGuard` and
 * `PermissionGuard`). Does nothing unless the route (method or class) is
 * `@RequireVerifiedTeacher()`; then any missing verification step (`VerificationService.status`)
 * → `403 TEACHER_NOT_VERIFIED` with `details: { missing }` (AC-SAFE-01). The user is the one
 * `JwtAuthGuard` loaded for this request; none → `401 UNAUTHENTICATED` (fails closed).
 */
@Injectable()
export class TeacherVerifiedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verification: VerificationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_VERIFIED_TEACHER_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const user = RequestContext.get()?.user;
    if (!user) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Authentication required');
    }
    const { missing } = await this.verification.status(user);
    if (missing.length > 0) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'TEACHER_NOT_VERIFIED',
        'Teacher verification is incomplete',
        { missing },
      );
    }
    return true;
  }
}
