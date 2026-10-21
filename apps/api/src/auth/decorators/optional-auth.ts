import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

export const OPTIONAL_AUTH_KEY = 'auth:optional';

/**
 * The route serves anonymous callers and signed-in ones alike (SP2 public token routes:
 * `GET/POST /invitations/{token}…`, `GET/POST /join/{code}…`):
 * - `JwtAuthGuard`: no cookie, an invalid or expired token, a revoked session or a deleted account
 *   → the request goes on **without** `store.user` (never `401`); a valid access token loads
 *   `store.user` and `store.session` exactly as on a protected route;
 * - `AccountGatesGuard`: no user → pass; a user whose `status !== 'ACTIVE'` → `403
 *   ACCOUNT_SUSPENDED` (AC-SAFE-04 holds); the email-verified, consents and 2FA-setup gates are
 *   skipped (the emailed link proves the mailbox; pending consents are handled by the web after
 *   acceptance).
 * The handler reads `RequestContext.get()?.user` and must cope with `undefined`.
 */
export const OptionalAuth = (): MethodDecorator & ClassDecorator =>
  SetMetadata(OPTIONAL_AUTH_KEY, true);

/** Whether the matched route (method or class) is `@OptionalAuth()`. */
export function isOptionalAuthRequest(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  );
}
