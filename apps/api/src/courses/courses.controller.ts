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
  Res,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { CourseDetail, CoursesPage, CourseStructure } from '@nibras/contracts';
import type { Response } from 'express';
import { IfMatch, setEtag } from '../common/if-match';
import { StructureService } from '../structure/structure.service';
import { RequirePermission, RequireVerifiedTeacher } from '../tenancy/decorators';
import { courseCtx } from './course-access';
import { CoursesService, type CourseTransition } from './courses.service';
import { CoursesQueryDto, CreateCourseDto, ReassignCourseDto, UpdateCourseDto } from './dto';

/**
 * Courses of a workspace (PRD §8.4.1, §10.7; spec §4.1, §7). Behind `WorkspaceContextGuard`: a
 * non-member of `:wid` gets 404, a SUSPENDED/DELETING workspace refuses the mutations (423).
 * STUDENT/GUARDIAN memberships → `403 PERMISSION_DENIED` (they use `/me/courses`). Scope `own`
 * (TEACHER, personal OWNER): only the caller's courses; another's course is `404`. Responses
 * carrying a course set `ETag: "<version>"`; `PATCH` needs `If-Match` (`428`/`409`).
 */
@Controller('workspaces/:wid/courses')
export class CoursesController {
  constructor(
    private readonly courses: CoursesService,
    private readonly structure: StructureService,
  ) {}

  /** Newest first; `status`, `q` (title), `cursor` = the previous `nextCursor`. */
  @Get()
  @RequirePermission('course.manage')
  list(@Param('wid') wid: string, @Query() query: CoursesQueryDto): Promise<CoursesPage> {
    return this.courses.list(courseCtx(wid), query);
  }

  /** `201`: a DRAFT owned by the caller (version 1). Audited `course.created`. */
  @Post()
  @RequirePermission('course.create')
  async create(
    @Param('wid') wid: string,
    @Body() body: CreateCourseDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CourseDetail> {
    return withEtag(res, await this.courses.create(courseCtx(wid), body));
  }

  /** The course, its counts and publication check; `ETag: "<version>"`. */
  @Get(':cid')
  @RequirePermission('course.manage')
  async get(
    @Param('wid') wid: string,
    @Param('cid') cid: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CourseDetail> {
    return withEtag(res, await this.courses.get(courseCtx(wid), cid));
  }

  /**
   * The editor's view (spec §4.2): modules → lessons by position with their media statuses;
   * `ETag: "<course version>"` (the `If-Match` of every structure write).
   */
  @Get(':cid/structure')
  @RequirePermission('course.manage')
  async structureOf(
    @Param('wid') wid: string,
    @Param('cid') cid: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CourseStructure> {
    const structure = await this.structure.structure(courseCtx(wid), cid);
    setEtag(res, structure.version);
    return structure;
  }

  /**
   * Course settings. `If-Match: "<version>"` required (`428 VERSION_REQUIRED`); a stale version →
   * `409 VERSION_CONFLICT { currentVersion }`. Audited `course.updated`.
   */
  @Patch(':cid')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('course.manage')
  @ApiHeader({ name: 'If-Match', required: true, description: 'The course version: "<version>"' })
  async update(
    @Param('wid') wid: string,
    @Param('cid') cid: string,
    @Body() body: UpdateCourseDto,
    @IfMatch() expected: number | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CourseDetail> {
    return withEtag(res, await this.courses.update(courseCtx(wid), cid, body, expected));
  }

  /**
   * `204`: soft deletion of a DRAFT or ARCHIVED course without ACTIVE enrollment (`409
   * COURSE_STATUS_INVALID` with `hint: 'ARCHIVE_FIRST'` / `409 COURSE_HAS_ACTIVE_ENROLLMENTS`).
   */
  @Delete(':cid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('course.delete')
  async remove(@Param('wid') wid: string, @Param('cid') cid: string): Promise<void> {
    await this.courses.remove(courseCtx(wid), cid);
  }

  /**
   * `DRAFT → PUBLISHED` (verified teacher, D-O6): needs a module and a TEXT or READY lesson (`422
   * COURSE_NOT_PUBLISHABLE { missing, lessons }`); notifies the enrolled students by job.
   */
  @Post(':cid/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('course.manage')
  @RequireVerifiedTeacher()
  publish(
    @Param('wid') wid: string,
    @Param('cid') cid: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CourseDetail> {
    return this.move(wid, cid, 'publish', res);
  }

  /** `PUBLISHED → DRAFT`: students lose access; enrollments and progress are kept (AC-CRS-02). */
  @Post(':cid/unpublish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('course.manage')
  unpublish(
    @Param('wid') wid: string,
    @Param('cid') cid: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CourseDetail> {
    return this.move(wid, cid, 'unpublish', res);
  }

  /** `PUBLISHED → ARCHIVED`. */
  @Post(':cid/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('course.manage')
  archive(
    @Param('wid') wid: string,
    @Param('cid') cid: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CourseDetail> {
    return this.move(wid, cid, 'archive', res);
  }

  /** `ARCHIVED → PUBLISHED`. */
  @Post(':cid/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('course.manage')
  restore(
    @Param('wid') wid: string,
    @Param('cid') cid: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CourseDetail> {
    return this.move(wid, cid, 'restore', res);
  }

  /**
   * A new owner (organisations only, `409 NOT_AN_ORGANIZATION`): an ACTIVE TEACHER, or ADMIN/OWNER
   * with `canTeach`, of this workspace (else `422`). Audited `course.reassigned`.
   */
  @Post(':cid/reassign')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('course.reassign')
  async reassign(
    @Param('wid') wid: string,
    @Param('cid') cid: string,
    @Body() body: ReassignCourseDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CourseDetail> {
    return withEtag(res, await this.courses.reassign(courseCtx(wid), cid, body.ownerUserId));
  }

  private async move(
    wid: string,
    cid: string,
    name: CourseTransition,
    res: Response,
  ): Promise<CourseDetail> {
    return withEtag(res, await this.courses.transition(courseCtx(wid), cid, name));
  }
}

function withEtag(res: Response, course: CourseDetail): CourseDetail {
  setEtag(res, course.version);
  return course;
}
