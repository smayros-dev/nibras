/**
 * Domain events of the enrollments (SP3 spec §7, D14), emitted fire-and-forget through
 * `EventEmitter2` once the change is committed. SP7 (notification centre) and SP5 (sessions
 * linked to a course) listen to them; SP3 itself sends its interim emails through worker jobs.
 */

/** Event name of {@link CourseAssignedEvent}. */
export const COURSE_ASSIGNED = 'course.assigned';

/**
 * Students got (or got back) an ACTIVE enrollment in a PUBLISHED course: `enrollmentIds` and
 * `studentUserIds` are parallel. A DRAFT course emits nothing at assignment; its students hear of
 * it through {@link CoursePublishedEvent}.
 */
export class CourseAssignedEvent {
  constructor(
    readonly workspaceId: string,
    readonly courseId: string,
    readonly enrollmentIds: readonly string[],
    readonly studentUserIds: readonly string[],
    readonly assignedByUserId: string,
  ) {}
}

/** Event name of {@link CoursePublishedEvent}. */
export const COURSE_PUBLISHED = 'course.published';

/** A course went `DRAFT → PUBLISHED` (`version` = the published version). */
export class CoursePublishedEvent {
  constructor(
    readonly workspaceId: string,
    readonly courseId: string,
    readonly version: number,
  ) {}
}

/** Event name of {@link EnrollmentRevokedEvent}. */
export const ENROLLMENT_REVOKED = 'enrollment.revoked';

/**
 * An enrollment went `ACTIVE → REVOKED` (staff revocation, or the student's membership was
 * rejected). SP5 cancels the student's participations in the course's sessions (D-P22).
 */
export class EnrollmentRevokedEvent {
  constructor(
    readonly workspaceId: string,
    readonly courseId: string,
    readonly studentUserId: string,
  ) {}
}
