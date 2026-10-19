import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { GuardianInfo } from '@nibras/contracts';
import { CurrentUser } from '../auth/decorators/current-user';
import type { AuthUser } from '../common/request-context';
import { CrossTenant } from '../tenancy/decorators';
import { GuardianService } from './guardian.service';

/**
 * The student's own guardian consent resend (PRD §8.3.5; design §4.4, D12). Deliberately under
 * `/me`, not `/workspaces/:wid`: the student's membership is inactive while it waits on the
 * consent, so the workspace guard would refuse him. The membership is found by the caller's
 * `userId` (`crossTenantDb()`); a workspace where he has no STUDENT membership → `404`.
 */
@Controller('me/workspaces/:wid/guardian')
@CrossTenant()
export class MeGuardianController {
  constructor(private readonly guardian: GuardianService) {}

  /**
   * A new 14-day consent link to the guardian on record (the previous one stops working). `409
   * MEMBERSHIP_NOT_PENDING` unless the membership waits on the consent; `429` within 10 minutes
   * of the last send; `423` while the workspace is suspended or being deleted.
   */
  @Post('resend-consent')
  @HttpCode(HttpStatus.OK)
  resend(@CurrentUser() user: AuthUser, @Param('wid') wid: string): Promise<GuardianInfo> {
    return this.guardian.resendForSelf(user, wid);
  }
}
