import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { GuardianInfo } from '@nibras/contracts';
import { memberCtx } from '../members/members.service';
import { RequirePermission, RequireVerifiedTeacher } from '../tenancy/decorators';
import { GuardianService } from './guardian.service';

/**
 * The staff's guardian consent resend for one student (PRD §8.3.5, §9.5; design §4.4). Behind
 * `WorkspaceContextGuard` (non-member → 404, SUSPENDED/DELETING workspace → 423);
 * `student.update` (scope `own`: an organisation TEACHER resends only for his students — else
 * 404, like a uid of another workspace) and a verified teacher (D-O6: the route sends an email).
 * SP2 T8's students controller shares the `workspaces/:wid/students` prefix.
 */
@Controller('workspaces/:wid/students/:uid/guardian')
@RequirePermission('student.update')
export class StudentGuardianController {
  constructor(private readonly guardian: GuardianService) {}

  /**
   * A new 14-day consent link to the guardian on record; the membership stays as it is until the
   * guardian decides. `409 MEMBERSHIP_NOT_PENDING` unless it waits on the consent; `429` within
   * 10 minutes of the last send (`details.retryAfterS`).
   */
  @Post('resend-consent')
  @HttpCode(HttpStatus.OK)
  @RequireVerifiedTeacher()
  resend(@Param('wid') wid: string, @Param('uid') uid: string): Promise<GuardianInfo> {
    return this.guardian.resendForStudent(memberCtx(wid), uid);
  }
}
