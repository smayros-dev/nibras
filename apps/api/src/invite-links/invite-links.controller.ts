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
} from '@nestjs/common';
import type { InviteLink } from '@nibras/contracts';
import { invitationCtx } from '../invitations/invitations.service';
import { RequirePermission, RequireVerifiedTeacher } from '../tenancy/decorators';
import { CreateInviteLinkDto, UpdateInviteLinkDto } from './dto';
import { InviteLinksService } from './invite-links.service';

/**
 * Group invite links of a workspace (PRD §8.3.3, design §4.3). Behind `WorkspaceContextGuard`: a
 * non-member of `:wid` gets 404, a SUSPENDED/DELETING workspace refuses the mutations (423). A
 * link id of another workspace is 404. Scope: an organisation TEACHER sees and manages only the
 * links he created. Creating a link is `@RequireVerifiedTeacher()` (D-O6): its code lets students
 * in.
 */
@Controller('workspaces/:wid/invite-links')
@RequirePermission('student.invite')
export class InviteLinksController {
  constructor(private readonly links: InviteLinksService) {}

  /** Newest first; `status` is derived (an `ACTIVE` link past `expiresAt` is `EXPIRED`). */
  @Get()
  list(@Param('wid') wid: string): Promise<InviteLink[]> {
    return this.links.list(invitationCtx(wid));
  }

  /**
   * `201`: a STUDENT code (8 characters) and its public `url`. Defaults: approval required in an
   * organisation, 50 uses, 30 days.
   */
  @Post()
  @RequireVerifiedTeacher()
  create(@Param('wid') wid: string, @Body() body: CreateInviteLinkDto): Promise<InviteLink> {
    return this.links.create(invitationCtx(wid), body);
  }

  /** Label, status (`ACTIVE` / `DISABLED`), use limit, expiry, approval flag. */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('wid') wid: string,
    @Param('id') id: string,
    @Body() body: UpdateInviteLinkDto,
  ): Promise<InviteLink> {
    return this.links.update(invitationCtx(wid), id, body);
  }

  /** `204`: the link is disabled (kept for the audit trail); its code answers `410`. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disable(@Param('wid') wid: string, @Param('id') id: string): Promise<void> {
    await this.links.disable(invitationCtx(wid), id);
  }
}
