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
import { ApiBody } from '@nestjs/swagger';
import type { EnrollmentsPage, EnrollResult } from '@nibras/contracts';
import { courseCtx } from '../courses/course-access';
import { RequirePermission } from '../tenancy/decorators';
import { EnrollmentsQueryDto, EnrollStudentsDto, RevokeEnrollmentDto } from './dto';
import { EnrollmentsService } from './enrollments.service';

/**
 * Enrollments of a course (PRD §8.5.1, §10.8; spec §4.5, §7). Behind `WorkspaceContextGuard`
 * (non-member → 404, SUSPENDED/DELETING workspace → 423 on the writes). STUDENT/GUARDIAN
 * memberships → `403 PERMISSION_DENIED` (`courseCtx`). Scope `own` (TEACHER, personal OWNER):
 * the caller's courses only (another's is `404`); in an organisation, only students assigned to
 * him or invited by him may be assigned.
 */
@Controller('workspaces/:wid/courses/:cid')
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  /**
   * `200`: each id with `created` (`true` when this call made the enrollment ACTIVE). A PUBLISHED
   * course notifies the new students by job; `422` names the refused `studentUserIds[i]`;
   * ARCHIVED → `409 COURSE_STATUS_INVALID`.
   */
  @Post('enrollments')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('enrollment.manage')
  enroll(
    @Param('wid') wid: string,
    @Param('cid') cid: string,
    @Body() body: EnrollStudentsDto,
  ): Promise<EnrollResult> {
    return this.enrollments.enroll(courseCtx(wid), cid, body.studentUserIds);
  }

  /** Enrolled students with their progress; `status`, `cursor`, `limit`. */
  @Get('enrollments')
  @RequirePermission('progress.read')
  list(
    @Param('wid') wid: string,
    @Param('cid') cid: string,
    @Query() query: EnrollmentsQueryDto,
  ): Promise<EnrollmentsPage> {
    return this.enrollments.list(courseCtx(wid), cid, query);
  }

  /** The course's progress view: the enrollment list (SP4 enriches it). */
  @Get('progress')
  @RequirePermission('progress.read')
  progress(
    @Param('wid') wid: string,
    @Param('cid') cid: string,
    @Query() query: EnrollmentsQueryDto,
  ): Promise<EnrollmentsPage> {
    return this.enrollments.list(courseCtx(wid), cid, query);
  }

  /**
   * `204`: ACTIVE → REVOKED (progress kept; the student loses access); already REVOKED → `204`;
   * no enrollment → `404`. Optional body `{ reason }`.
   */
  @Delete('enrollments/:uid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBody({ type: RevokeEnrollmentDto, required: false })
  @RequirePermission('enrollment.manage')
  async revoke(
    @Param('wid') wid: string,
    @Param('cid') cid: string,
    @Param('uid') uid: string,
    @Body() body: RevokeEnrollmentDto,
  ): Promise<void> {
    await this.enrollments.revoke(courseCtx(wid), cid, uid, body.reason);
  }
}
