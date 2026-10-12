import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@tt/contracts';

/**
 * Route metadata read by the global tenancy guards (registered in `AppModule` after the account
 * gates). Each decorator only marks the route; the matching guard does the work.
 */

export const REQUIRE_VERIFIED_TEACHER_KEY = 'tenancy:require-verified-teacher';
export const REQUIRE_PERMISSION_KEY = 'tenancy:require-permission';
export const CROSS_TENANT_KEY = 'tenancy:cross-tenant';

/**
 * The caller must be a verified teacher (D-O6, AC-SAFE-01): email verified, phone verified by SMS
 * code, code of conduct accepted at its current version; otherwise `TeacherVerifiedGuard`
 * answers `403 TEACHER_NOT_VERIFIED` with `details.missing`. Required on the routes that invite a
 * student (SP2 `POST …/invitations`, `…/invite-links`), publish a course (SP3
 * `POST …/courses/{cid}/publish`) and open a room (SP6 `POST …/room/open`).
 */
export const RequireVerifiedTeacher = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_VERIFIED_TEACHER_KEY, true);

/**
 * The caller's membership in the route's workspace (`:wid`, loaded by `WorkspaceContextGuard`)
 * must grant `p` (PRD §7, `grantFor`): `none` → `403 PERMISSION_DENIED`; `own` → the request runs
 * with `RequestContext.permissionScope = 'own'` and the service calls `assertOwn(ownerUserId)`
 * (or filters its queries on the caller) for every resource it touches. Only valid on a
 * `/workspaces/:wid/…` route: elsewhere `PermissionGuard` fails with a 500 (a wiring bug).
 */
export const RequirePermission = (p: Permission): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PERMISSION_KEY, p);

/**
 * Documentation marker: the route reads across workspaces on purpose (`/me/…`, super-admin
 * console) through `crossTenantDb()`, so it has no `:wid` and no workspace context. No guard
 * reads it; the generic isolation test (Task 18) and reviewers use it to tell a deliberate
 * cross-tenant route from a missing `:wid`.
 */
export const CrossTenant = (): MethodDecorator & ClassDecorator =>
  SetMetadata(CROSS_TENANT_KEY, true);
