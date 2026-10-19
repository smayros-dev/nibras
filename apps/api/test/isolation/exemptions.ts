/**
 * Routes under `/workspaces/{wid}` the generic isolation suite must NOT probe.
 *
 * Empty in SP1: every tenant route must answer `404` to a caller without a membership.
 * Later plans may only add an entry here together with a `reason` that is reviewed in
 * code review — an exemption hides a route from the isolation guarantee.
 *
 * An entry applies to **every** scenario of `tenant-routes.e2e-spec.ts` (non-members, foreign
 * path params / cursors / bodies, inactive memberships, read-only states — SP1.6 F8), not only
 * to the non-member one: there is no per-scenario exemption.
 */
export const TENANT_ROUTE_EXEMPTIONS: { method: string; path: string; reason: string }[] = [];
