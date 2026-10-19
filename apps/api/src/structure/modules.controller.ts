import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { CourseStructure, ModuleWithLessons } from '@nibras/contracts';
import type { Response } from 'express';
import { IfMatch, setEtag } from '../common/if-match';
import { courseCtx } from '../courses/course-access';
import { RequirePermission } from '../tenancy/decorators';
import { CreateModuleDto, ReorderDto, UpdateModuleDto } from './dto';
import { StructureService, type Versioned } from './structure.service';

export const IF_MATCH_REQUIRED = {
  name: 'If-Match',
  required: true,
  description: 'The course version: "<version>"',
};
export const IF_MATCH_OPTIONAL = {
  name: 'If-Match',
  required: false,
  description: 'The course version: "<version>" (checked when given)',
};

/** Sets `ETag: "<course version>"` and returns the value. */
export function withCourseEtag<T>(res: Response, result: Versioned<T>): T {
  setEtag(res, result.courseVersion);
  return result.value;
}

/**
 * Modules of a course (PRD §8.4.2, spec §4.2, §7), `course.manage`. Same rules as the course
 * routes: another workspace's, another teacher's (scope `own`) or a deleted course's module is
 * `404`; STUDENT/GUARDIAN memberships → `403`. Every write answers `ETag: "<course version>"`;
 * `If-Match` with the **course** version is required on PATCH and reorder (`428`/`409`), checked
 * when given on create and delete.
 */
@Controller('workspaces/:wid')
export class ModulesController {
  constructor(private readonly structure: StructureService) {}

  /** `201`: appended at the end. Audited `module.created`. */
  @Post('courses/:cid/modules')
  @RequirePermission('course.manage')
  @ApiHeader(IF_MATCH_OPTIONAL)
  async create(
    @Param('wid') wid: string,
    @Param('cid') cid: string,
    @Body() body: CreateModuleDto,
    @IfMatch() expected: number | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ModuleWithLessons> {
    return withCourseEtag(
      res,
      await this.structure.createModule(courseCtx(wid), cid, body, expected),
    );
  }

  /** The full ordered set of the course's module ids (`422` otherwise); the new structure. */
  @Post('courses/:cid/modules/reorder')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('course.manage')
  @ApiHeader(IF_MATCH_REQUIRED)
  async reorder(
    @Param('wid') wid: string,
    @Param('cid') cid: string,
    @Body() body: ReorderDto,
    @IfMatch() expected: number | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CourseStructure> {
    return withCourseEtag(
      res,
      await this.structure.reorderModules(courseCtx(wid), cid, body.ids, expected),
    );
  }

  /** Title, description, optional flag, unlock rule (`NONE` / `PREVIOUS_MODULE_COMPLETED`). */
  @Patch('modules/:mid')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('course.manage')
  @ApiHeader(IF_MATCH_REQUIRED)
  async update(
    @Param('wid') wid: string,
    @Param('mid') mid: string,
    @Body() body: UpdateModuleDto,
    @IfMatch() expected: number | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ModuleWithLessons> {
    return withCourseEtag(
      res,
      await this.structure.updateModule(courseCtx(wid), mid, body, expected),
    );
  }

  /** `204`: the module and its lessons (their media stay); the next modules move up. */
  @Delete('modules/:mid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('course.manage')
  @ApiHeader(IF_MATCH_OPTIONAL)
  async remove(
    @Param('wid') wid: string,
    @Param('mid') mid: string,
    @IfMatch() expected: number | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    setEtag(res, await this.structure.deleteModule(courseCtx(wid), mid, expected));
  }
}
