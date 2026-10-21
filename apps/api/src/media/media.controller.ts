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
import type {
  Download,
  MediaAssetView,
  MediaPage,
  Playback,
  UploadState,
  UploadTicket,
} from '@nibras/contracts';
import { tenantDb } from '@nibras/db';
import { courseCtx } from '../courses/course-access';
import { RequirePermission, RequireVerifiedTeacher } from '../tenancy/decorators';
import { CompleteUploadDto, CreateUploadDto, MediaQueryDto } from './dto';
import { findMediaInScope, MediaService } from './media.service';
import { PlaybackService } from './playback.service';
import { UploadService } from './upload.service';

/**
 * The media library of a workspace (PRD §8.4.4; spec §4.3, §4.4, §7). Behind
 * `WorkspaceContextGuard` (a non-member of `:wid` gets 404; SUSPENDED/DELETING → 423 on writes).
 * STUDENT/GUARDIAN memberships → `403 PERMISSION_DENIED` (they reach media through `/me/lessons`).
 * Scope `own` (TEACHER, personal OWNER): his uploads and the media of his courses; another's
 * asset is `404`. Every URL in a response is presigned and short-lived: never log one.
 */
@Controller('workspaces/:wid/media')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly uploads: UploadService,
    private readonly player: PlaybackService,
  ) {}

  /** Newest first; `kind`, `status`, `cursor` = the previous `nextCursor`. */
  @Get()
  @RequirePermission('course.media.manage')
  list(@Param('wid') wid: string, @Query() query: MediaQueryDto): Promise<MediaPage> {
    return this.media.list(courseCtx(wid), query);
  }

  /**
   * `201`: an upload ticket — `S3_MULTIPART` (8 MiB parts, the first 100 part URLs, 1 h) or `TUS`
   * (Cloudflare Stream). Verified teachers only (D-O6). `422` over the kind's limit or outside its
   * types; `402 QUOTA_EXCEEDED` when the declared size does not fit (used + reserved).
   */
  @Post('uploads')
  @RequirePermission('course.media.manage')
  @RequireVerifiedTeacher()
  createUpload(@Param('wid') wid: string, @Body() body: CreateUploadDto): Promise<UploadTicket> {
    return this.uploads.create(courseCtx(wid), body);
  }

  /** The asset and the lessons that use it. */
  @Get(':mediaId')
  @RequirePermission('course.media.manage')
  get(@Param('wid') wid: string, @Param('mediaId') mediaId: string): Promise<MediaAssetView> {
    return this.media.get(courseCtx(wid), mediaId);
  }

  /**
   * Resume an S3 multipart upload (AC-MED-01): the stored parts and fresh URLs for the missing
   * ones. `409 UPLOAD_NOT_PENDING` (not uploading, or tus), `410 UPLOAD_EXPIRED`.
   */
  @Get(':mediaId/upload')
  @RequirePermission('course.media.manage')
  uploadState(@Param('wid') wid: string, @Param('mediaId') mediaId: string): Promise<UploadState> {
    return this.uploads.state(courseCtx(wid), mediaId);
  }

  /**
   * Finish an upload: size, signature (`415 INVALID_FILE_SIGNATURE`, `422 MEDIA_KIND_MISMATCH`)
   * and quota (`402`) checks, then `PROCESSING`. `parts` omitted → the stored parts. tus: no-op.
   */
  @Post(':mediaId/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('course.media.manage')
  complete(
    @Param('wid') wid: string,
    @Param('mediaId') mediaId: string,
    @Body() body: CompleteUploadDto,
  ): Promise<MediaAssetView> {
    return this.uploads.complete(courseCtx(wid), mediaId, body);
  }

  /**
   * `204`: an unused asset is deleted (`DELETING`, then by job at the provider; an `UPLOADING`
   * one at once). Used by a lesson → `409 MEDIA_IN_USE { lessons }` (AC-MED-08).
   */
  @Delete(':mediaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('course.media.manage')
  async remove(@Param('wid') wid: string, @Param('mediaId') mediaId: string): Promise<void> {
    await this.media.remove(courseCtx(wid), mediaId);
  }

  /**
   * The teacher's preview (D-O8): VIDEO → `MP4` (S3, 2 h) or `HLS` (Cloudflare, 2 h); PDF →
   * inline URL (5 min). READY only (`409 MEDIA_NOT_READY`); 30 grants per user and hour (`429`).
   */
  @Get(':mediaId/playback')
  @RequirePermission('course.media.manage')
  async playback(@Param('wid') wid: string, @Param('mediaId') mediaId: string): Promise<Playback> {
    const ctx = courseCtx(wid);
    const asset = await findMediaInScope(tenantDb(wid), ctx, mediaId);
    return this.player.playback(ctx.userId, wid, asset, { allowDownload: true });
  }

  /** A READY PDF as a 5-minute `attachment` URL (`pdf.download`; teachers always may). */
  @Get(':mediaId/download')
  @RequirePermission('pdf.download')
  async download(@Param('wid') wid: string, @Param('mediaId') mediaId: string): Promise<Download> {
    const ctx = courseCtx(wid);
    const asset = await findMediaInScope(tenantDb(wid), ctx, mediaId);
    return this.player.download(ctx.userId, wid, asset);
  }
}
