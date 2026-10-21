import type { MembershipRole } from '@nibras/db';

/** Event name of {@link MembershipRemovedEvent} (`EventEmitter2`). */
export const MEMBERSHIP_REMOVED = 'membership.removed';

/**
 * Emitted once a membership is committed as `REMOVED` (fire-and-forget). Later sub-projects
 * listen to it: SP6 disconnects the member from the workspace's rooms (≤ 60 s), SP5 cancels his
 * future participations (PRD §8.3.3).
 */
export class MembershipRemovedEvent {
  constructor(
    readonly workspaceId: string,
    readonly userId: string,
    readonly role: MembershipRole,
  ) {}
}

/** Event name of {@link InvitationAcceptedEvent} (`EventEmitter2`). */
export const INVITATION_ACCEPTED = 'invitation.accepted';

/**
 * Emitted once an invitation's acceptance is committed (SP2: email invitation accepted, whatever
 * the resulting membership status — a minor's stays `PENDING_GUARDIAN_CONSENT`).
 */
export class InvitationAcceptedEvent {
  constructor(
    readonly workspaceId: string,
    readonly invitationId: string,
    readonly userId: string,
    readonly role: MembershipRole,
  ) {}
}

/** Event name of {@link MembershipActivatedEvent} (`EventEmitter2`). */
export const MEMBERSHIP_ACTIVATED = 'membership.activated';

/**
 * Emitted once a membership is committed as `ACTIVE` from a pending or suspended status (SP2:
 * acceptance of an adult, approval, guardian grant or re-grant).
 */
export class MembershipActivatedEvent {
  constructor(
    readonly workspaceId: string,
    readonly userId: string,
  ) {}
}

/** Event name of {@link MembershipDeactivatedEvent} (`EventEmitter2`). */
export const MEMBERSHIP_DEACTIVATED = 'membership.deactivated';

/**
 * Where a membership goes when deactivated in SP2 (a removal emits {@link MembershipRemovedEvent}).
 */
export type DeactivatedMembershipStatus =
  'SUSPENDED_NO_CONSENT' | 'SUSPENDED_CONSENT_REVOKED' | 'REJECTED';

/** Why: the guardian refused, revoked or never answered (14 days), or a staff member rejected. */
export type MembershipDeactivationReason =
  'CONSENT_REFUSED' | 'CONSENT_REVOKED' | 'CONSENT_EXPIRED' | 'REJECTED';

/**
 * Emitted (fire-and-forget) once a membership is committed as suspended or rejected by the API
 * (guardian refusal / revocation, approval queue rejection). Later sub-projects listen to it: SP5
 * cancels the member's future participations, SP6 disconnects him from the workspace's rooms. The
 * worker's daily consent expiry cannot emit in-process events: SP5/SP6 add their own reaction to
 * that job when they exist.
 */
export class MembershipDeactivatedEvent {
  constructor(
    readonly workspaceId: string,
    readonly userId: string,
    readonly status: DeactivatedMembershipStatus,
    readonly reason: MembershipDeactivationReason,
  ) {}
}

/** Event name of {@link InviteLinkJoinedEvent} (`EventEmitter2`). */
export const INVITE_LINK_JOINED = 'invite_link.joined';

/**
 * Emitted once a join through a group invite link is committed, whatever the resulting
 * membership status (`ACTIVE`, `PENDING_APPROVAL`, `PENDING_GUARDIAN_CONSENT`). SP3 turns the
 * link's `courseIds` into enrollments.
 */
export class InviteLinkJoinedEvent {
  constructor(
    readonly workspaceId: string,
    readonly inviteLinkId: string,
    readonly userId: string,
  ) {}
}
