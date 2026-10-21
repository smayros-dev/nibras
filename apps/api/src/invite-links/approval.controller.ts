import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { MemberSummary } from '@nibras/contracts';
import { invitationCtx } from '../invitations/invitations.service';
import { RequirePermission } from '../tenancy/decorators';
import { ApprovalService } from './approval.service';

/**
 * The approval queue of group codes (PRD §8.3.3, §12.1 « Membres approve/reject »; design §4.3).
 * Behind `WorkspaceContextGuard` (non-member → 404, SUSPENDED/DELETING workspace → 423). Only a
 * STUDENT membership in `PENDING_APPROVAL` is decided (else `409 MEMBERSHIP_NOT_PENDING`); an
 * organisation TEACHER decides only for the students of his own links (else 404).
 */
@Controller('workspaces/:wid/members/:uid')
@RequirePermission('student.invite')
export class ApprovalController {
  constructor(private readonly approval: ApprovalService) {}

  /**
   * `ACTIVE`, or `PENDING_GUARDIAN_CONSENT` for a minor without consent — his guardian is emailed
   * now (D5). The student receives `join.approved`.
   */
  @Post('approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('wid') wid: string, @Param('uid') uid: string): Promise<MemberSummary> {
    return this.approval.approve(invitationCtx(wid), uid);
  }

  /** `REJECTED` (`removalReason: 'REJECTED'`); the student receives `join.rejected`. */
  @Post('reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('wid') wid: string, @Param('uid') uid: string): Promise<MemberSummary> {
    return this.approval.reject(invitationCtx(wid), uid);
  }
}
