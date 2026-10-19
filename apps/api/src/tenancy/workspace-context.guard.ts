import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { tenantDb, type GuardedClient, type MembershipStatus } from '@nibras/db';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { isPublicRequest } from '../auth/decorators/public';
import { ApiError } from '../common/api-error';
import { RequestContext } from '../common/request-context';
import { DB } from '../db/db.module';

/** The route parameter that makes a route tenant-scoped (`/workspaces/:wid/…`). */
export const WORKSPACE_PARAM = 'wid';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Methods a SUSPENDED / DELETING workspace still serves (AC-WS-06: reads stay possible). */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Membership statuses of a minor waiting for (or deprived of) the guardian's consent. */
const GUARDIAN_CONSENT_STATUSES: ReadonlySet<MembershipStatus> = new Set<MembershipStatus>([
  'PENDING_GUARDIAN_CONSENT',
  'SUSPENDED_NO_CONSENT',
  'SUSPENDED_CONSENT_REVOKED',
]);

const WORKSPACE_ROUTE = new RegExp(`^workspaces/:${WORKSPACE_PARAM}(/|$)`);

function pathsOf(
  reflector: Reflector,
  target: ReturnType<ExecutionContext['getHandler']>,
): string[] {
  const path = reflector.get<string | string[] | undefined>(PATH_METADATA, target);
  const list = path === undefined ? [''] : Array.isArray(path) ? path : [path];
  return list.map((p) => p.replace(/^\/+|\/+$/g, ''));
}

/**
 * Whether the matched route is a tenant route: its declared path (controller path + handler
 * path, from Nest's route metadata, below the global `api/v1` prefix) starts with
 * `workspaces/:wid`. Other routes carrying a `:wid` param (super-admin console
 * `/admin/workspaces/:wid/…`) are not tenant routes: no membership is required there.
 */
export function isWorkspaceRoute(reflector: Reflector, context: ExecutionContext): boolean {
  const controllerPaths = pathsOf(reflector, context.getClass());
  const handlerPaths = pathsOf(reflector, context.getHandler());
  return controllerPaths.some((c) =>
    handlerPaths.some((h) => WORKSPACE_ROUTE.test([c, h].filter(Boolean).join('/'))),
  );
}

/**
 * Global guard #3 (after `JwtAuthGuard` and `AccountGatesGuard`). Does nothing unless the route
 * is declared under `workspaces/:wid` (`isWorkspaceRoute`); then:
 * 1. loads the workspace (`db.workspace`) and the caller's membership (`tenantDb(wid)`, so RLS
 *    applies too);
 * 2. no such workspace (or a malformed id) → `404 NOT_FOUND`; the workspace exists but the caller
 *    has no membership, a `REMOVED`/`REJECTED` one, or is a `SUPER_ADMIN` without membership →
 *    audit `auth.forbidden_workspace` then the same `404 NOT_FOUND` — never a 403 that would
 *    reveal the workspace exists (AC-WS-01);
 * 3. a minor's membership blocked on the parental consent (`PENDING_GUARDIAN_CONSENT`,
 *    `SUSPENDED_NO_CONSENT`, `SUSPENDED_CONSENT_REVOKED`, D-O5) → `403 GUARDIAN_CONSENT_REQUIRED`
 *    with `details.status` (the web shows the guardian waiting panel); any other non-ACTIVE
 *    membership (`PENDING_APPROVAL`) → `403 MEMBERSHIP_INACTIVE` with `details.status`;
 * 4. stores `workspace` and `membership` in `RequestContext`;
 * 5. workspace `SUSPENDED`/`DELETING` and a method other than GET/HEAD/OPTIONS →
 *    `423 WORKSPACE_SUSPENDED` with `details: { status, reason }` (AC-WS-06), before any
 *    permission check.
 */
@Injectable()
export class WorkspaceContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Pick<GuardedClient, 'workspace'>,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    if (!isWorkspaceRoute(this.reflector, context)) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const params = req.params as Record<string, string | undefined> | undefined;
    const wid = params?.[WORKSPACE_PARAM];
    if (wid === undefined) return true;
    if (isPublicRequest(this.reflector, context)) return true;

    const store = RequestContext.get();
    const user = store?.user;
    // Fails closed: a tenant route reached without an authenticated user.
    if (!store || !user) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Authentication required');
    }
    if (!UUID.test(wid)) throw notFound();

    const workspace = await this.db.workspace.findUnique({
      where: { id: wid },
      select: { id: true, type: true, status: true, suspendedReason: true },
    });
    if (!workspace) throw notFound();

    const membership = await tenantDb(wid).membership.findFirst({
      where: { userId: user.id },
      select: { id: true, role: true, canTeach: true, status: true },
    });
    if (!membership || membership.status === 'REMOVED' || membership.status === 'REJECTED') {
      // Covers a SUPER_ADMIN without membership: the platform console has its own routes.
      await this.audit.log({
        action: 'auth.forbidden_workspace',
        entityType: 'workspace',
        entityId: wid,
        workspaceId: wid,
      });
      throw notFound();
    }
    if (GUARDIAN_CONSENT_STATUSES.has(membership.status)) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'GUARDIAN_CONSENT_REQUIRED',
        'Parental consent is required for this workspace',
        { status: membership.status },
      );
    }
    if (membership.status !== 'ACTIVE') {
      throw new ApiError(HttpStatus.FORBIDDEN, 'MEMBERSHIP_INACTIVE', 'Membership is not active', {
        status: membership.status,
      });
    }

    store.workspace = { id: workspace.id, type: workspace.type, status: workspace.status };
    store.membership = membership;

    if (workspace.status !== 'ACTIVE' && !READ_METHODS.has(req.method.toUpperCase())) {
      throw new ApiError(423, 'WORKSPACE_SUSPENDED', 'Workspace is suspended (read-only)', {
        status: workspace.status,
        reason: workspace.suspendedReason,
      });
    }
    return true;
  }
}

/** The generic 404 is the intended answer here (AC-WS-01): indistinguishable from a bad route. */
function notFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
}
