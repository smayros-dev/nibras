import { Module } from '@nestjs/common';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { GuardianModule } from '../guardian/guardian.module';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

/**
 * The students of a workspace (PRD §8.3, §9.1; design §4.5): list, profile skeleton, guardian
 * email. The staff's consent resend (`POST …/students/{uid}/guardian/resend-consent`) lives in
 * `GuardianModule` (`StudentGuardianController`) under the same prefix. Imports `GuardianModule`
 * (`GuardianService`: the guardian email change) and `EnrollmentsModule` (`StudentCoursesService`:
 * the `courses` / `progressPercent` of the list and profile); depends on the global `DbModule` and
 * `AuditModule`.
 */
@Module({
  imports: [GuardianModule, EnrollmentsModule],
  controllers: [StudentsController],
  providers: [StudentsService],
})
export class StudentsModule {}
