/** Event name of {@link UserSuspendedEvent} (`EventEmitter2`). */
export const USER_SUSPENDED = 'user.suspended';

/**
 * Emitted once a user's suspension is committed (fire-and-forget; never on an idempotent repeat).
 * Later sub-projects listen to it for AC-SAFE-04's remainder: SP5 cancels his `SCHEDULED`
 * sessions (`TEACHER_SUSPENDED` to participants and admins), SP6 ends his `LIVE` ones
 * (`TEACHER_ENDED`, system actor).
 */
export class UserSuspendedEvent {
  constructor(
    readonly userId: string,
    readonly reason: string,
  ) {}
}
