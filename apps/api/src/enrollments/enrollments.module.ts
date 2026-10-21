import { Module } from '@nestjs/common';
import { EnrollmentHooksListener } from './enrollment-hooks.listener';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';
import { StudentCoursesService } from './student-courses.service';

/**
 * Enrollments (SP3, spec §4.5): the course's enrollment routes, the SP2 hooks turning invitation
 * and invite-link `courseIds` into enrollments, and `StudentCoursesService` (the `courses` /
 * `progressPercent` of SP2's students list and profile). Depends on the global `DbModule`,
 * `AuditModule`, `QueueModule` and `EventEmitterModule`. Exports both services.
 */
@Module({
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService, EnrollmentHooksListener, StudentCoursesService],
  exports: [EnrollmentsService, StudentCoursesService],
})
export class EnrollmentsModule {}
