import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type {
  Download,
  MyCourseDetail,
  MyCourses,
  MyLessonDetail,
  Playback,
  ProgressActionResult,
} from '@nibras/contracts';
import { CurrentUser } from '../auth/decorators/current-user';
import type { AuthUser } from '../common/request-context';
import { CrossTenant } from '../tenancy/decorators';
import { LearnService } from './learn.service';
import { ProgressService } from './progress.service';

/**
 * The student's courses and lessons (PRD §8.5–8.6; spec §4.6, §7). Under `/me`, not
 * `/workspaces/:wid`: one student follows courses of several workspaces. Each route resolves the
 * caller's enrollment through `crossTenantDb()` then reads under `tenantDb(wid)`: not enrolled →
 * `404`; REVOKED → `403 ENROLLMENT_REVOKED`; membership not ACTIVE → `403
 * GUARDIAN_CONSENT_REQUIRED` / `MEMBERSHIP_INACTIVE`; course not PUBLISHED / ARCHIVED → `403
 * COURSE_NOT_AVAILABLE`; locked lesson → `403 MODULE_LOCKED` / `LESSON_LOCKED` with the lock.
 */
@Controller('me')
@CrossTenant()
export class LearnController {
  constructor(
    private readonly learn: LearnService,
    private readonly progress: ProgressService,
  ) {}

  /** His courses in every workspace, by last activity. */
  @Get('courses')
  courses(@CurrentUser() user: AuthUser): Promise<MyCourses> {
    return this.learn.myCourses(user.id);
  }

  /** The outline with locks, percents and progress; `next` = where to resume. */
  @Get('courses/:cid')
  course(@CurrentUser() user: AuthUser, @Param('cid') cid: string): Promise<MyCourseDetail> {
    return this.learn.course(user.id, cid);
  }

  /** A lesson with its content (TEXT) or playback grant (READY VIDEO / PDF, else `null`). */
  @Get('lessons/:lid')
  lesson(@CurrentUser() user: AuthUser, @Param('lid') lid: string): Promise<MyLessonDetail> {
    return this.learn.lesson(user.id, lid);
  }

  /** A fresh playback grant (silent renewal); `429` beyond 30 an hour; `409 MEDIA_NOT_READY`. */
  @Get('lessons/:lid/playback')
  playback(@CurrentUser() user: AuthUser, @Param('lid') lid: string): Promise<Playback> {
    return this.learn.playback(user.id, lid);
  }

  /** A 5-minute PDF download URL; `403 DOWNLOAD_NOT_ALLOWED` unless allowed by the teacher. */
  @Get('lessons/:lid/download')
  download(@CurrentUser() user: AuthUser, @Param('lid') lid: string): Promise<Download> {
    return this.learn.download(user.id, lid);
  }

  /** IN_PROGRESS and `openedAt` (a completed lesson stays completed). */
  @Post('lessons/:lid/opened')
  @HttpCode(HttpStatus.OK)
  opened(@CurrentUser() user: AuthUser, @Param('lid') lid: string): Promise<ProgressActionResult> {
    return this.progress.opened(user.id, lid);
  }

  /** « Marquer comme terminé »; a PDF never opened → `409 LESSON_NOT_OPENED`. */
  @Post('lessons/:lid/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentUser() user: AuthUser,
    @Param('lid') lid: string,
  ): Promise<ProgressActionResult> {
    return this.progress.complete(user.id, lid);
  }

  /** « Annuler terminé »: back to IN_PROGRESS (the course's `completedAt` is kept). */
  @Post('lessons/:lid/uncomplete')
  @HttpCode(HttpStatus.OK)
  uncomplete(
    @CurrentUser() user: AuthUser,
    @Param('lid') lid: string,
  ): Promise<ProgressActionResult> {
    return this.progress.uncomplete(user.id, lid);
  }
}
