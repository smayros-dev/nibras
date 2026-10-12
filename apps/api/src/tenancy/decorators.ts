import { SetMetadata } from '@nestjs/common';

/**
 * Route metadata read by the global tenancy guards (registered in `AppModule` after the account
 * gates). Each decorator only marks the route; the matching guard does the work.
 */

export const REQUIRE_VERIFIED_TEACHER_KEY = 'tenancy:require-verified-teacher';

/**
 * The caller must be a verified teacher (D-O6, AC-SAFE-01): email verified, phone verified by SMS
 * code, code of conduct accepted at its current version; otherwise `TeacherVerifiedGuard`
 * answers `403 TEACHER_NOT_VERIFIED` with `details.missing`. Required on the routes that invite a
 * student (SP2 `POST …/invitations`, `…/invite-links`), publish a course (SP3
 * `POST …/courses/{cid}/publish`) and open a room (SP6 `POST …/room/open`).
 */
export const RequireVerifiedTeacher = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_VERIFIED_TEACHER_KEY, true);
