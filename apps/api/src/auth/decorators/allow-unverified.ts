import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNVERIFIED_KEY = 'auth:allow-unverified';

/**
 * The route needs a session but skips the email-verified, pending-consents and 2FA-setup gates:
 * resend-verification, `GET /me`, the 2FA setup routes. A suspended account is still refused
 * (`AccountGatesGuard`). Logout is `@Public()`.
 */
export const AllowUnverified = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_UNVERIFIED_KEY, true);
