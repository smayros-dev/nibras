import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '../../common/api-error';
import { RequestContext } from '../../common/request-context';
import { ConsentService } from '../../me/consent.service';
import { ALLOW_UNVERIFIED_KEY } from '../decorators/allow-unverified';
import { isPublicRequest } from '../decorators/public';
import { requiresTwoFactor } from '../two-factor.policy';

/**
 * Global guard #2, after `JwtAuthGuard`. Skipped entirely for a public request (`@Public()`,
 * logout included, or `@PublicWithChallenge()` with a `challengeToken`). In order:
 * 1. `user.status !== 'ACTIVE'` → `403 ACCOUNT_SUSPENDED` on EVERY authenticated route, including
 *    `@AllowUnverified()` ones (PRD §8.1.6 / AC-SAFE-04: a suspension disconnects immediately;
 *    `JwtAuthGuard` already refuses DELETING/DELETED with `401 SESSION_REVOKED`);
 * then, unless the route (method or class) is `@AllowUnverified()` (`GET /me`,
 * resend-verification, `/auth/2fa/*`, `POST /me/consents/{type}`):
 * 2. `emailVerifiedAt == null` → `403 EMAIL_NOT_VERIFIED`;
 * 3. a required consent (`REQUIRED_CONSENTS`) not accepted at its current `CONSENT_VERSIONS`
 *    → `403 CONSENT_REQUIRED` with `details.pending` (AC-GDPR-06: a version bump applies at the
 *    next request; one indexed consent query per request);
 * 4. 2FA required (`requiresTwoFactor`: SUPER_ADMIN, organisation OWNER/ADMIN) and
 *    `totpEnabledAt == null` → `403 TWO_FACTOR_SETUP_REQUIRED` (AC-AUTH-05). Only users without
 *    TOTP pay the membership query.
 * The user is the one `JwtAuthGuard` loaded for this request (read from the database per request).
 */
@Injectable()
export class AccountGatesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly consents: ConsentService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (isPublicRequest(this.reflector, context)) return true;

    const user = RequestContext.get()?.user;
    // Fails closed: a non-public route reached without an authenticated user.
    if (!user) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Authentication required');
    }
    if (user.status !== 'ACTIVE') {
      throw new ApiError(HttpStatus.FORBIDDEN, 'ACCOUNT_SUSPENDED', 'Account suspended');
    }
    if (this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_UNVERIFIED_KEY, targets)) {
      return true;
    }
    if (user.emailVerifiedAt === null) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'EMAIL_NOT_VERIFIED', 'Email address not verified');
    }
    const pending = await this.consents.pending(user.id);
    if (pending.length > 0) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'CONSENT_REQUIRED',
        'Updated terms must be accepted',
        { pending },
      );
    }
    if (user.totpEnabledAt === null && (await requiresTwoFactor(user))) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'TWO_FACTOR_SETUP_REQUIRED',
        'Two-factor authentication must be set up',
      );
    }
    return true;
  }
}
