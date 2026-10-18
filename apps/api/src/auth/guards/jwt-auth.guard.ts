import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { GuardedClient } from '@nibras/db';
import type { Request } from 'express';
import { ApiError } from '../../common/api-error';
import { RequestContext, type AuthUser } from '../../common/request-context';
import { DB } from '../../db/db.module';
import { accessTokenOf } from '../cookies';
import { isPublicRequest } from '../decorators/public';
import { JwtService, type AccessPayload } from '../jwt.service';
import { credentialsOutdated, sessionRevoked } from '../session.service';

/** The `AuthUser` columns (never hashes or secrets). */
export const AUTH_USER_SELECT = {
  id: true,
  email: true,
  status: true,
  platformRole: true,
  locale: true,
  timezone: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  totpEnabledAt: true,
  firstName: true,
  lastName: true,
} as const satisfies Record<keyof AuthUser, true>;

const unauthenticated = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Authentication required');

/**
 * Global guard #1 (skipped by `@Public()`, and by `@PublicWithChallenge()` when the body has a
 * `challengeToken`): a valid `typ: 'access'` JWT from
 * `Authorization: Bearer` or the `tt_access` cookie (else `401 UNAUTHENTICATED`), whose session
 * is read with its user in ONE query on every request, so a revocation or a deleted account takes
 * effect immediately rather than when the 15-minute token expires: missing, revoked or expired
 * session, session of another user, or deleted account → `401 SESSION_REVOKED`. Fills
 * `RequestContext` `user` and `session`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: Pick<GuardedClient, 'userSession'>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicRequest(this.reflector, context)) return true;

    const token = accessTokenOf(context.switchToHttp().getRequest<Request>());
    if (!token) throw unauthenticated();
    let payload: AccessPayload;
    try {
      payload = await this.jwt.verify(token, 'access');
    } catch {
      throw unauthenticated();
    }

    const session = await this.db.userSession.findUnique({
      where: { id: payload.sid },
      select: {
        id: true,
        familyId: true,
        userId: true,
        revokedAt: true,
        expiresAt: true,
        credentialsVersion: true,
        user: { select: { ...AUTH_USER_SELECT, credentialsVersion: true } },
      },
    });
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now() ||
      session.user.status === 'DELETING' ||
      session.user.status === 'DELETED' ||
      credentialsOutdated(session.credentialsVersion, session.user.credentialsVersion)
    ) {
      throw sessionRevoked();
    }
    const { credentialsVersion: _version, ...user } = session.user;

    const store = RequestContext.get();
    // Fails closed: without the request context nothing downstream could see the user.
    if (!store) throw unauthenticated();
    store.user = user;
    store.session = { id: session.id, familyId: session.familyId };
    return true;
  }
}
