/**
 * What may stop a member's removal (AC-WS-05): a blocker answers `null` (nothing in the way) or
 * the code and the items in the way, which `DELETE /workspaces/{wid}/members/{uid}` returns as
 * `409 <code>` with `details.items` (the client lists them).
 */
export interface MemberRemovalBlocker {
  check(
    workspaceId: string,
    userId: string,
  ): Promise<{ code: 'MEMBER_HAS_FUTURE_SESSIONS'; items: unknown[] } | null>;
}

/**
 * Injection token of the `MemberRemovalBlocker[]` consulted, in order, before a removal. SP1
 * registers none (`[]`, see `MembersModule`); SP5 contributes its future-sessions check by turning
 * that provider into a factory that injects its blocker(s). Tests override it with stubs.
 */
export const MEMBER_REMOVAL_BLOCKERS = Symbol('MEMBER_REMOVAL_BLOCKERS');
