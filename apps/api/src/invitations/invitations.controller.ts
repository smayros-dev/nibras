import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { InvitationSummary, InvitationsPage } from '@nibras/contracts';
import { RequirePermission, RequireVerifiedTeacher } from '../tenancy/decorators';
import { CreateInvitationDto, InvitationsQueryDto, UpdateInvitationDto } from './dto';
import { InvitationsService, invitationCtx } from './invitations.service';

/**
 * Email invitations of a workspace (PRD §8.3.1, §8.2.2). Behind `WorkspaceContextGuard`: a
 * non-member of `:wid` gets 404, a SUSPENDED/DELETING workspace refuses the mutations (423). An
 * invitation id of another workspace is 404. Scope: an organisation TEACHER sees and manages only
 * the invitations he created; staff rows (TEACHER / ADMIN) need `workspace.staff.manage`. The
 * routes that send an email are `@RequireVerifiedTeacher()` (D-O6). The raw token never appears
 * in a response.
 *
 * SP2 T10 adds the `import/*` routes: they must be declared above `':id'` in this controller.
 */
@Controller('workspaces/:wid/invitations')
@RequirePermission('student.invite')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  /** Newest first; `status` filters on the derived status (a stored PENDING past expiry is EXPIRED). */
  @Get()
  list(@Param('wid') wid: string, @Query() query: InvitationsQueryDto): Promise<InvitationsPage> {
    return this.invitations.list(invitationCtx(wid), query);
  }

  /**
   * `201`: a `PENDING` invitation valid 7 days, emailed inline. `409 ALREADY_MEMBER` /
   * `409 INVITATION_PENDING` (`details.invitationId`); staff roles: `422
   * INVITATION_ROLE_NOT_ALLOWED` outside an organisation, `403` without staff management.
   */
  @Post()
  @RequireVerifiedTeacher()
  create(@Param('wid') wid: string, @Body() body: CreateInvitationDto): Promise<InvitationSummary> {
    return this.invitations.create(invitationCtx(wid), body);
  }

  @Get(':id')
  get(@Param('wid') wid: string, @Param('id') id: string): Promise<InvitationSummary> {
    return this.invitations.get(invitationCtx(wid), id);
  }

  /** Names, guardian email, message of a PENDING / EXPIRED invitation (else `409`). */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('wid') wid: string,
    @Param('id') id: string,
    @Body() body: UpdateInvitationDto,
  ): Promise<InvitationSummary> {
    return this.invitations.update(invitationCtx(wid), id, body);
  }

  /**
   * New link (the previous one stops working), 7 more days, `resentCount + 1`. Within 10 minutes
   * of the last send → `429 RATE_LIMITED` with `details.retryAfterS`.
   */
  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  @RequireVerifiedTeacher()
  resend(@Param('wid') wid: string, @Param('id') id: string): Promise<InvitationSummary> {
    return this.invitations.resend(invitationCtx(wid), id);
  }

  /** `204`: the invitation becomes `REVOKED`; its link answers `410 INVITATION_REVOKED`. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Param('wid') wid: string, @Param('id') id: string): Promise<void> {
    await this.invitations.revoke(invitationCtx(wid), id);
  }
}
