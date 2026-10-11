import type { Locale } from '@tt/contracts';

/** Event name of {@link TeacherRegisteredEvent} (`EventEmitter2`). */
export const TEACHER_REGISTERED = 'auth.teacher_registered';

/** Emitted once a teacher's account and personal workspace are committed (SP10 analytics). */
export class TeacherRegisteredEvent {
  constructor(
    readonly userId: string,
    readonly workspaceId: string,
    readonly locale: Locale,
    readonly occurredAt: Date,
  ) {}
}
