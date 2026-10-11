import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '../../common/api-error';
import { RequestContext } from '../../common/request-context';
import { ALLOW_UNVERIFIED_KEY } from '../decorators/allow-unverified';
import { IS_PUBLIC_KEY } from '../decorators/public';

/**
 * Global guard #2, after `JwtAuthGuard`. Skipped by `@Public()` and by `@AllowUnverified()`
 * (method or class: logout, `GET /me`, resend-verification, the 2FA setup routes), which only
 * need a session. Otherwise, in order:
 * 1. `user.status === 'SUSPENDED'` → `403 ACCOUNT_SUSPENDED`;
 * 2. `emailVerifiedAt == null` → `403 EMAIL_NOT_VERIFIED`;
 * 3. pending consents → `403 CONSENT_REQUIRED` with `details.pending` (Task 11);
 * 4. 2FA required but not set up → `403 TWO_FACTOR_SETUP_REQUIRED` (Task 10).
 * The user is the one `JwtAuthGuard` loaded for this request (read from the database per request).
 */
@Injectable()
export class AccountGatesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_UNVERIFIED_KEY, targets)) {
      return true;
    }

    const user = RequestContext.get()?.user;
    // Fails closed: a non-public route reached without an authenticated user.
    if (!user) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Authentication required');
    }
    if (user.status === 'SUSPENDED') {
      throw new ApiError(HttpStatus.FORBIDDEN, 'ACCOUNT_SUSPENDED', 'Account suspended');
    }
    if (user.emailVerifiedAt === null) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'EMAIL_NOT_VERIFIED', 'Email address not verified');
    }
    // Step 3 (Task 11): pending consents → 403 CONSENT_REQUIRED { pending }.
    // Step 4 (Task 10): 2FA required and not enabled → 403 TWO_FACTOR_SETUP_REQUIRED.
    return true;
  }
}
