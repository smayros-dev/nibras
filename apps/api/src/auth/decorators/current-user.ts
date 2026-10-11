import { createParamDecorator, HttpStatus } from '@nestjs/common';
import { ApiError } from '../../common/api-error';
import { RequestContext, type AuthUser } from '../../common/request-context';

/** The authenticated user (`RequestContext`, set by the JWT guard). */
export function currentUser(): AuthUser {
  const user = RequestContext.get()?.user;
  // Fails closed: a route reached without an authenticated user (a missing guard) is a 401.
  if (!user) {
    throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Authentication required');
  }
  return user;
}

/** Parameter decorator resolving to the authenticated `AuthUser`; 401 when there is none. */
export const CurrentUser = createParamDecorator((_data: unknown): AuthUser => currentUser());
