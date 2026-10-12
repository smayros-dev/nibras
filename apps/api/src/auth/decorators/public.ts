import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'auth:public';
export const IS_PUBLIC_WITH_CHALLENGE_KEY = 'auth:public-with-challenge';

/** The route needs no session: the JWT guard (and the account gates) skip it. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * The route is `@Public()` for a request whose JSON body carries a string `challengeToken` (the
 * 2FA step of a login, authenticated by that token instead of a session) and needs a session
 * otherwise (`POST /auth/2fa/verify` confirming a setup).
 */
export const PublicWithChallenge = (): MethodDecorator =>
  SetMetadata(IS_PUBLIC_WITH_CHALLENGE_KEY, true);

/** Whether this request skips authentication: `@Public()`, or `@PublicWithChallenge()` + token. */
export function isPublicRequest(reflector: Reflector, context: ExecutionContext): boolean {
  const targets = [context.getHandler(), context.getClass()];
  if (reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets)) return true;
  if (!reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_WITH_CHALLENGE_KEY, targets)) {
    return false;
  }
  const body: unknown = context.switchToHttp().getRequest<Request>().body;
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { challengeToken?: unknown }).challengeToken === 'string'
  );
}
