import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Query } from '@nestjs/common';
import type { StudentProfile, StudentSummary, StudentsPage } from '@nibras/contracts';
import { RequirePermission, RequireVerifiedTeacher } from '../tenancy/decorators';
import { StudentsQueryDto, UpdateStudentDto } from './dto';
import { StudentsService, studentCtx } from './students.service';

/**
 * Students of a workspace (PRD §8.3, §9.1, §15 "Étudiants"). Behind `WorkspaceContextGuard`: a
 * non-member of `:wid` gets 404, a SUSPENDED/DELETING workspace refuses the mutation (423). A
 * `:uid` that is not a STUDENT of `:wid` (or outside the caller's scope) is 404. Scope `own`
 * (organisation TEACHER / ASSISTANT): his assigned or invited students, without their email; a
 * guardian's email only for the students he invited (Q7). Pending email invitations are listed by
 * `GET …/invitations`.
 */
@Controller('workspaces/:wid/students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  /**
   * STUDENT memberships (every status but `REMOVED` / `REJECTED` unless `status` asks), with
   * `isMinor` and the guardian link's status. Ordered by last name, first name, user id;
   * `cursor` = the previous `nextCursor`.
   */
  @Get()
  @RequirePermission('student.read')
  list(@Param('wid') wid: string, @Query() query: StudentsQueryDto): Promise<StudentsPage> {
    return this.students.list(studentCtx(wid), query);
  }

  /**
   * The profile skeleton (any membership status, `REMOVED` included for the history): identity,
   * membership, guardian, assigned teachers; the course / progress / session / attendance /
   * report / activity sections stay empty until the sub-projects that fill them.
   */
  @Get(':uid/profile')
  @RequirePermission('student.read')
  profile(@Param('wid') wid: string, @Param('uid') uid: string): Promise<StudentProfile> {
    return this.students.profile(studentCtx(wid), uid);
  }

  /**
   * A minor's guardian email (adult → `422 VALIDATION_FAILED`, the student's own address → `422
   * GUARDIAN_EMAIL_INVALID`, a consent already given → `409 CONSENT_ALREADY_DECIDED`). The
   * previous guardian's links stop working; while the membership waits on the consent, the new
   * guardian is emailed a 14-day request, hence a verified teacher (D-O6). Names are not
   * editable once the account exists (Q1).
   */
  @Patch(':uid')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('student.update')
  @RequireVerifiedTeacher()
  update(
    @Param('wid') wid: string,
    @Param('uid') uid: string,
    @Body() body: UpdateStudentDto,
  ): Promise<StudentSummary> {
    return this.students.update(studentCtx(wid), uid, body);
  }
}
