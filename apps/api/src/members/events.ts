import type { MembershipRole } from '@tt/db';

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
