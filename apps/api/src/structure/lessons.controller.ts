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
  Res,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { LessonDetail, ModuleWithLessons } from '@nibras/contracts';
import type { Response } from 'express';
import { IfMatch, setEtag } from '../common/if-match';
import { courseCtx } from '../courses/course-access';
import { RequirePermission } from '../tenancy/decorators';
import { CreateLessonDto, ReorderDto, UpdateLessonDto, createLessonInput } from './dto';
import { IF_MATCH_OPTIONAL, IF_MATCH_REQUIRED, withCourseEtag } from './modules.controller';
import { StructureService } from './structure.service';

/**
 * Lessons of a module (PRD §8.4.3, spec §4.2, §7), `course.manage`: VIDEO / PDF with a media of
 * the workspace, TEXT with whitelisted rich text. Same `404`/`403`, `ETag` and `If-Match` rules as
 * the module routes.
 */
@Controller('workspaces/:wid')
export class LessonsController {
  constructor(private readonly structure: StructureService) {}

  /**
   * `201`: appended at the end. Media of another kind → `422 MEDIA_KIND_MISMATCH`, neither READY
   * nor PROCESSING → `409 MEDIA_NOT_READY`, unknown or foreign → `404`. Audited `lesson.created`.
   */
  @Post('modules/:mid/lessons')
  @RequirePermission('course.manage')
  @ApiHeader(IF_MATCH_OPTIONAL)
  async create(
    @Param('wid') wid: string,
    @Param('mid') mid: string,
    @Body() body: CreateLessonDto,
    @IfMatch() expected: number | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LessonDetail> {
    return withCourseEtag(
      res,
      await this.structure.createLesson(courseCtx(wid), mid, createLessonInput(body), expected),
    );
  }

  /** The full ordered set of the module's lesson ids (`422` otherwise); the module. */
  @Post('modules/:mid/lessons/reorder')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('course.manage')
  @ApiHeader(IF_MATCH_REQUIRED)
  async reorder(
    @Param('wid') wid: string,
    @Param('mid') mid: string,
    @Body() body: ReorderDto,
    @IfMatch() expected: number | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ModuleWithLessons> {
    return withCourseEtag(
      res,
      await this.structure.reorderLessons(courseCtx(wid), mid, body.ids, expected),
    );
  }

  /** The lesson with its content and `images` (5-minute inline URLs by `mediaId`); `ETag`. */
  @Get('lessons/:lid')
  @RequirePermission('course.manage')
  async get(
    @Param('wid') wid: string,
    @Param('lid') lid: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LessonDetail> {
    return withCourseEtag(res, await this.structure.lesson(courseCtx(wid), lid));
  }

  /** The type is immutable; fields foreign to it → `422`. Audited `lesson.updated`. */
  @Patch('lessons/:lid')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('course.manage')
  @ApiHeader(IF_MATCH_REQUIRED)
  async update(
    @Param('wid') wid: string,
    @Param('lid') lid: string,
    @Body() body: UpdateLessonDto,
    @IfMatch() expected: number | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LessonDetail> {
    return withCourseEtag(
      res,
      await this.structure.updateLesson(courseCtx(wid), lid, body, expected),
    );
  }

  /** `204`: the next lessons move up; the media stays. Audited `lesson.deleted`. */
  @Delete('lessons/:lid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('course.manage')
  @ApiHeader(IF_MATCH_OPTIONAL)
  async remove(
    @Param('wid') wid: string,
    @Param('lid') lid: string,
    @IfMatch() expected: number | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    setEtag(res, await this.structure.deleteLesson(courseCtx(wid), lid, expected));
  }
}
