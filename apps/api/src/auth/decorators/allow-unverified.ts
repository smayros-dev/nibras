import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNVERIFIED_KEY = 'auth:allow-unverified';

/**
 * The route needs a session but skips the account gates (email not verified, pending consents,
 * 2FA setup required): resend-verification, logout, `GET /me`, the 2FA setup routes.
 */
export const AllowUnverified = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_UNVERIFIED_KEY, true);
