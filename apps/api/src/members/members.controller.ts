import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import type { MemberSummary, MembersPage } from '@tt/contracts';
import { RequirePermission } from '../tenancy/decorators';
import { MembersQueryDto, RemoveMemberDto, UpdateMemberDto } from './dto';
import { MembersService, memberCtx } from './members.service';

/**
 * Members of a workspace (PRD §15 "Membres"). Behind `WorkspaceContextGuard`: a non-member of
 * `:wid` gets 404, a SUSPENDED/DELETING workspace refuses the mutations (423). A `:uid` that is
 * not a member of `:wid` is 404, whatever other workspace he belongs to.
 */
@Controller('workspaces/:wid/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  /**
   * Staff (scope `all`): every member, with emails. Organisation TEACHER/ASSISTANT (scope `own`):
   * his assigned or invited students, without emails. `REMOVED`/`REJECTED` only through
   * `status`. Ordered by last name, first name, user id; `cursor` = the previous `nextCursor`.
   */
  @Get()
  @RequirePermission('workspace.members.read')
  list(@Param('wid') wid: string, @Query() query: MembersQueryDto): Promise<MembersPage> {
    return this.members.list(memberCtx(wid), query);
  }

  /** One member, same scoping as the list (outside it → 404). */
  @Get(':uid')
  @RequirePermission('workspace.members.read')
  get(@Param('wid') wid: string, @Param('uid') uid: string): Promise<MemberSummary> {
    return this.members.get(memberCtx(wid), uid);
  }

  /**
   * Role between ADMIN and TEACHER (else `422 ROLE_CHANGE_NOT_ALLOWED`) and the ADMIN's
   * `canTeach`. Audited `member.role_changed`.
   */
  @Patch(':uid')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('workspace.staff.manage')
  update(
    @Param('wid') wid: string,
    @Param('uid') uid: string,
    @Body() body: UpdateMemberDto,
  ): Promise<MemberSummary> {
    return this.members.update(memberCtx(wid), uid, body);
  }

  /**
   * `204`: the membership becomes `REMOVED` (optional `reason`). A STUDENT/GUARDIAN needs
   * `student.remove`, staff `workspace.staff.manage` (checked by the service: the permission
   * depends on the target); the OWNER → `409 OWNER_CANNOT_BE_REMOVED`; a removal blocker (SP5:
   * future sessions) → `409 MEMBER_HAS_FUTURE_SESSIONS` with `details.items`.
   */
  @Delete(':uid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBody({ type: RemoveMemberDto, required: false })
  async remove(
    @Param('wid') wid: string,
    @Param('uid') uid: string,
    @Body() body: RemoveMemberDto,
  ): Promise<void> {
    await this.members.remove(memberCtx(wid), uid, body.reason);
  }
}
