import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  MEDIA_DELETE_JOB,
  QUEUES,
  mediaDeleteJobId,
  type MediaAssetView,
  type MediaDeleteJob,
  type MediaPage,
  type MediaQuery,
} from '@nibras/contracts';
import { Prisma, tenantDb, withTenantTx, type MediaAsset, type TenantTx } from '@nibras/db';
import type { StorageProvider, VideoProvider } from '@nibras/providers';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { courseNotFound, isUuid, mediaScopeFilter, type CourseCtx } from '../courses/course-access';
import { QueueService } from '../queue/queue.service';
import { validationFailed } from '../workspaces/workspaces.service';
import { QuotaService } from './quota.service';
import { STORAGE_PROVIDER, VIDEO_PROVIDER_TOKEN } from './tokens';

/** The lessons that use an asset, with their course (`usedBy`, `MEDIA_IN_USE`). */
const USED_BY_SELECT = {
  id: true,
  title: true,
  mediaAssetId: true,
  module: { select: { course: { select: { id: true, title: true, status: true } } } },
} satisfies Prisma.LessonSelect;

type UsedByRow = Prisma.LessonGetPayload<{ select: typeof USED_BY_SELECT }>;

export type UsedBy = MediaAssetView['usedBy'];

/** Any client that reads media and lessons of one workspace (`tenantDb(wid)` or a tenant tx). */
type MediaReader = Pick<TenantTx, 'mediaAsset' | 'lesson'>;

export function mediaNotFound(): ApiError {
  return courseNotFound();
}

/**
 * The asset `mediaId` of the caller's workspace within his scope (`mediaScopeFilter`: scope `own`
 * = his uploads or the media of his courses), DELETING rows included; else `404`.
 */
export async function findMediaInScope(
  client: Pick<TenantTx, 'mediaAsset'>,
  ctx: CourseCtx,
  mediaId: string,
): Promise<MediaAsset> {
  if (!isUuid(mediaId)) throw mediaNotFound();
  const asset = await client.mediaAsset.findFirst({
    where: { AND: [{ id: mediaId }, mediaScopeFilter(ctx)] },
  });
  if (!asset) throw mediaNotFound();
  return asset;
}

function toUsedBy(rows: UsedByRow[]): UsedBy {
  return rows.map((l) => ({
    lessonId: l.id,
    lessonTitle: l.title,
    courseId: l.module.course.id,
    courseTitle: l.module.course.title,
    courseStatus: l.module.course.status,
  }));
}

/** `MediaAsset` → `MediaAssetView` (bigint sizes as decimal strings; no storage key, no upload id). */
export function toMediaView(a: MediaAsset, usedBy: UsedBy): MediaAssetView {
  return {
    id: a.id,
    kind: a.kind,
    provider: a.provider,
    status: a.status,
    failureReason: a.failureReason,
    originalFilename: a.originalFilename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes.toString(),
    durationS: a.durationS,
    width: a.width,
    height: a.height,
    pageCount: a.pageCount,
    thumbnailUrl: a.thumbnailUrl,
    ownerUserId: a.ownerUserId,
    uploadUrlExpiresAt: a.uploadUrlExpiresAt?.toISOString() ?? null,
    readyAt: a.readyAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    usedBy,
  };
}

/** The view of `asset` with the lessons using it, read through `client`. */
export async function mediaView(client: MediaReader, asset: MediaAsset): Promise<MediaAssetView> {
  const lessons = await client.lesson.findMany({
    where: { mediaAssetId: asset.id },
    select: USED_BY_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  return toMediaView(asset, toUsedBy(lessons));
}

/**
 * The media library of a workspace (PRD §8.4.4; spec §4.3, §7): read, list and delete. Uploads
 * are `UploadService`, playback `PlaybackService`. Every read goes through `tenantDb(wid)` /
 * `withTenantTx(wid)` (another workspace's asset is `404`) and `mediaScopeFilter`.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly quota: QuotaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(VIDEO_PROVIDER_TOKEN) private readonly video: VideoProvider,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(MediaService.name);
  }

  /** `GET …/media/{mediaId}`: the asset and the lessons that use it. */
  async get(ctx: CourseCtx, mediaId: string): Promise<MediaAssetView> {
    const client = tenantDb(ctx.workspaceId);
    return mediaView(client, await findMediaInScope(client, ctx, mediaId));
  }

  /**
   * `GET …/media?kind&status&cursor&limit`: newest first (`createdAt` desc, `id` desc), Prisma's
   * cursor on the asset id. A cursor outside the filtered scope → `422` on `cursor`.
   */
  async list(ctx: CourseCtx, q: MediaQuery): Promise<MediaPage> {
    const client = tenantDb(ctx.workspaceId);
    const and: Prisma.MediaAssetWhereInput[] = [mediaScopeFilter(ctx)];
    if (q.kind) and.push({ kind: q.kind });
    if (q.status) and.push({ status: q.status });
    const where: Prisma.MediaAssetWhereInput = { AND: and };
    if (q.cursor !== undefined) {
      const row = await client.mediaAsset.findFirst({
        where: { AND: [where, { id: q.cursor }] },
        select: { id: true },
      });
      if (!row) throw validationFailed('cursor', 'Unknown cursor');
    }
    const rows = await client.mediaAsset.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor !== undefined && { cursor: { id: q.cursor }, skip: 1 }),
    });
    const items = rows.slice(0, q.limit);
    const lessons =
      items.length === 0
        ? []
        : await client.lesson.findMany({
            where: { mediaAssetId: { in: items.map((a) => a.id) } },
            select: USED_BY_SELECT,
            orderBy: { createdAt: 'asc' },
          });
    return {
      items: items.map((a) =>
        toMediaView(a, toUsedBy(lessons.filter((l) => l.mediaAssetId === a.id))),
      ),
      nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null,
    };
  }

  /**
   * `DELETE …/media/{mediaId}` (spec §4.3, D16): used by any lesson → `409 MEDIA_IN_USE
   * { lessons }` (AC-MED-08; the lesson must drop it first). `UPLOADING` → the multipart upload
   * (or the provider's direct upload) is aborted and the row removed now (nothing was counted).
   * Otherwise → `DELETING` (`deletedAt` set, so no lesson or cover can take it any more) and a
   * `media.delete` job deletes it at the provider, then the row, releasing its quota. Already
   * `DELETING` → the job is enqueued again (same `jobId`: a lost enqueue is retried, a live job is
   * not duplicated) and nothing else changes. Audited `media.deleted`.
   */
  async remove(ctx: CourseCtx, mediaId: string): Promise<void> {
    const outcome = await withTenantTx(ctx.workspaceId, async (tx) => {
      const found = await findMediaInScope(tx, ctx, mediaId);
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM "media_asset" WHERE id = ${found.id}::uuid FOR UPDATE`,
      );
      const asset = await tx.mediaAsset.findUniqueOrThrow({ where: { id: found.id } });
      if (asset.status === 'DELETING') return { asset, hard: false, again: true };
      const lessons = await tx.lesson.findMany({
        where: { mediaAssetId: asset.id },
        select: USED_BY_SELECT,
        orderBy: { createdAt: 'asc' },
      });
      if (lessons.length > 0) {
        throw new ApiError(HttpStatus.CONFLICT, 'MEDIA_IN_USE', 'The media is used by lessons', {
          lessons: toUsedBy(lessons),
        });
      }
      if (asset.status === 'UPLOADING') {
        await this.quota.release(tx, ctx.workspaceId, asset.id);
        await tx.mediaAsset.delete({ where: { id: asset.id } });
        return { asset, hard: true, again: false };
      }
      await tx.mediaAsset.update({
        where: { id: asset.id },
        data: { status: 'DELETING', deletedAt: new Date() },
      });
      return { asset, hard: false, again: false };
    });
    const { asset, hard, again } = outcome;
    if (hard) await this.abortUpload(asset);
    else await this.enqueueDelete(ctx.workspaceId, asset.id);
    if (again) return;
    await this.audit.log({
      action: 'media.deleted',
      entityType: 'MediaAsset',
      entityId: asset.id,
      before: { status: asset.status, kind: asset.kind },
      after: { status: hard ? 'DELETED' : 'DELETING' },
    });
  }

  /** Best effort: the row is gone; a pending part or provider upload left behind expires there. */
  private async abortUpload(asset: MediaAsset): Promise<void> {
    try {
      if (asset.storageKey && asset.uploadId) {
        await this.storage.abortMultipart(asset.storageKey, asset.uploadId);
      } else if (asset.providerAssetId) {
        await this.video.delete({ providerAssetId: asset.providerAssetId });
      }
    } catch (err) {
      this.logger.warn(
        { mediaId: asset.id, err: { type: err instanceof Error ? err.name : typeof err } },
        'media.upload_abort_failed',
      );
    }
  }

  private async enqueueDelete(workspaceId: string, mediaId: string): Promise<void> {
    const data: MediaDeleteJob = { mediaId, workspaceId };
    await this.queue.add(QUEUES.media, MEDIA_DELETE_JOB, data, {
      jobId: mediaDeleteJobId(mediaId),
    });
  }
}
