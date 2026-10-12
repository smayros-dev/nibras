import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { Assignment, AssignmentsPage } from '@tt/contracts';
import { RequirePermission } from '../tenancy/decorators';
import { AssignmentsService } from './assignments.service';
import { AssignmentsQueryDto, CreateAssignmentDto } from './dto';
import { memberCtx } from './members.service';

/** Teacher ↔ student assignments of a workspace (PRD §11.2, §15 "Membres"). */
@Controller('workspaces/:wid/assignments')
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  /**
   * `workspace.members.read`: staff see every assignment; an organisation TEACHER/ASSISTANT only
   * his own (as the teacher). Filters `teacherUserId`, `studentUserId`; oldest first.
   */
  @Get()
  @RequirePermission('workspace.members.read')
  list(@Param('wid') wid: string, @Query() query: AssignmentsQueryDto): Promise<AssignmentsPage> {
    return this.assignments.list(memberCtx(wid), query);
  }

  /**
   * `student.assign` (organisation OWNER/ADMIN): `201`; `409 ALREADY_ASSIGNED`; `422` unless an
   * ACTIVE TEACHER (or ADMIN/OWNER with `canTeach`) and an ACTIVE STUDENT. Audited.
   */
  @Post()
  @RequirePermission('student.assign')
  create(@Param('wid') wid: string, @Body() body: CreateAssignmentDto): Promise<Assignment> {
    return this.assignments.create(memberCtx(wid), body);
  }

  /** `student.assign`: `204`; an id that is not an assignment of this workspace → 404. Audited. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('student.assign')
  async remove(@Param('wid') wid: string, @Param('id') id: string): Promise<void> {
    await this.assignments.remove(memberCtx(wid), id);
  }
}
