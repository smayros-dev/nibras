import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  MEDIA_LIMITS,
  MEDIA_PROCESS_JOB,
  QUEUES,
  UPLOAD_ABANDON_AFTER_MS,
  UPLOAD_PARTS_PER_BATCH,
  UPLOAD_PART_SIZE_BYTES,
  UPLOAD_URL_TTL_S,
  mediaProcessJobId,
  partCount,
  type CompleteUploadInput,
  type CreateUploadInput,
  type MediaAssetView,
  type MediaFailureReason,
  type MediaProcessJob,
  type UploadState,
  type UploadTicket,
} from '@nibras/contracts';
import { tenantDb, uuidv7, withTenantTx, type MediaAsset } from '@nibras/db';
import {
  UnsupportedVideoError,
  storageKeyFor,
  type Part,
  type StorageProvider,
  type VideoProvider,
} from '@nibras/providers';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import type { CourseCtx } from '../courses/course-access';
import { mediaUploads } from '../observability/metrics';
import { QueueService } from '../queue/queue.service';
import { validationFailed } from '../workspaces/workspaces.service';
import { findMediaInScope, mediaView } from './media.service';
import { fits, quotaExceeded, QuotaService } from './quota.service';
import { assertSignature, SIGNATURE_BYTES } from './signature';
import { STORAGE_PROVIDER, VIDEO_PROVIDER_TOKEN } from './tokens';

/** Why `complete` refused the object: the asset's failure reason and the metric outcome. */
const REFUSALS = {
  INVALID_FILE_SIGNATURE: { reason: 'INVALID_SIGNATURE', outcome: 'invalid_signature' },
  MEDIA_KIND_MISMATCH: { reason: 'INVALID_SIGNATURE', outcome: 'kind_mismatch' },
} as const satisfies Record<string, { reason: MediaFailureReason; outcome: string }>;

/** S3 error names `CompleteMultipartUpload` answers for parts the client got wrong. */
const BAD_PARTS = new Set(['InvalidPart', 'InvalidPartOrder', 'EntityTooSmall', 'MalformedXML']);

const errorName = (err: unknown) => (err instanceof Error ? err.name : '');

function notPending(asset: Pick<MediaAsset, 'status'>, mode?: string): ApiError {
  return new ApiError(HttpStatus.CONFLICT, 'UPLOAD_NOT_PENDING', 'The upload is not pending', {
    status: asset.status,
    ...(mode !== undefined && { mode }),
  });
}

function uploadExpired(): ApiError {
  return new ApiError(HttpStatus.GONE, 'UPLOAD_EXPIRED', 'The upload has expired');
}

/** An upload is abandoned 24 h after its ticket (the hourly cleanup then marks it FAILED). */
const isAbandoned = (asset: Pick<MediaAsset, 'createdAt'>, now = Date.now()) =>
  asset.createdAt.getTime() + UPLOAD_ABANDON_AFTER_MS < now;

/** Maps a provider refusal (T3) to the same `422` the ticket schema gives for limits and types. */
function mapUnsupported(err: unknown): unknown {
  if (!(err instanceof UnsupportedVideoError)) return err;
  return err.reason === 'MIME_TYPE'
    ? validationFailed('mimeType', err.message)
    : validationFailed('sizeBytes', err.message);
}

/**
 * Upload tickets, resume and completion (PRD §8.4.4, §10.5; spec §4.3, D1, D17). S3 kinds (and
 * videos on the S3 passthrough provider) are browser-side S3 multipart uploads on presigned part
 * URLs; Cloudflare Stream videos are tus uploads straight to the provider. `complete` checks the
 * actual size, the signature and the quota before anything becomes readable; a refused object is
 * deleted and its asset `FAILED`.
 */
@Injectable()
export class UploadService {
  constructor(
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly quota: QuotaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(VIDEO_PROVIDER_TOKEN) private readonly video: VideoProvider,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(UploadService.name);
  }

  /**
   * `POST …/media/uploads` (verified teacher, D-O6). The schema already enforced the kind's size
   * limit and mime list (`422`); a video must also be a type the provider takes (S3: mp4/webm).
   * The declared size is reserved under the workspace lock (`402 QUOTA_EXCEEDED` when used +
   * reserved + size > quota), the asset created `UPLOADING`, then the provider opens the upload;
   * if it refuses, the asset is removed again. Audited `media.upload_created`.
   */
  async create(ctx: CourseCtx, input: CreateUploadInput): Promise<UploadTicket> {
    const isVideo = input.kind === 'VIDEO';
    if (isVideo && !this.video.acceptedMimeTypes.includes(input.mimeType)) {
      throw validationFailed(
        'mimeType',
        `Type ${input.mimeType} not accepted for VIDEO by this provider (${this.video.acceptedMimeTypes.join(', ')})`,
      );
    }
    const id = uuidv7();
    const size = BigInt(input.sizeBytes);
    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_S * 1000);
    const provider = isVideo ? this.video.name : 'S3';
    // A video's key (if any) comes from the video provider when it opens the upload.
    const storageKey = isVideo
      ? null
      : storageKeyFor({
          workspaceId: ctx.workspaceId,
          kind: input.kind,
          mediaId: id,
          filename: input.filename,
        });
    await withTenantTx(ctx.workspaceId, async (tx) => {
      await this.quota.assertRoom(tx, ctx.workspaceId, size);
      await tx.mediaAsset.create({
        data: {
          id,
          workspaceId: ctx.workspaceId,
          ownerUserId: ctx.userId,
          kind: input.kind,
          provider,
          status: 'UPLOADING',
          originalFilename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: size,
          storageKey,
          uploadUrlExpiresAt: expiresAt,
        },
      });
    });

    let ticket: UploadTicket;
    try {
      ticket = await this.openUpload(ctx, id, input, storageKey, expiresAt);
    } catch (err) {
      await tenantDb(ctx.workspaceId).mediaAsset.deleteMany({ where: { id } });
      throw mapUnsupported(err);
    }
    mediaUploads.inc({ kind: input.kind, outcome: 'created' });
    await this.audit.log({
      action: 'media.upload_created',
      entityType: 'MediaAsset',
      entityId: id,
      after: {
        kind: input.kind,
        provider,
        mode: ticket.mode,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType,
      },
    });
    return ticket;
  }

  /**
   * `GET …/media/{mediaId}/upload` (resume, AC-MED-01): the parts the store already holds and
   * fresh presigned URLs (1 h) for the first `UPLOAD_PARTS_PER_BATCH` missing ones. Not
   * `UPLOADING`, or a tus upload (the tus client resumes on its own) → `409 UPLOAD_NOT_PENDING`;
   * older than 24 h or gone from the store → `410 UPLOAD_EXPIRED`. Reads only.
   */
  async state(ctx: CourseCtx, mediaId: string): Promise<UploadState> {
    const asset = await findMediaInScope(tenantDb(ctx.workspaceId), ctx, mediaId);
    const { key, uploadId } = this.pendingMultipart(asset);
    const uploaded = await this.listParts(key, uploadId);
    const count = partCount(Number(asset.sizeBytes), UPLOAD_PART_SIZE_BYTES);
    const done = new Set(uploaded.map((p) => p.partNumber));
    const missing: number[] = [];
    for (let n = 1; n <= count && missing.length < UPLOAD_PARTS_PER_BATCH; n += 1) {
      if (!done.has(n)) missing.push(n);
    }
    return {
      mediaId: asset.id,
      mode: 'S3_MULTIPART',
      partSizeBytes: UPLOAD_PART_SIZE_BYTES,
      partCount: count,
      uploaded: uploaded.map((p) => ({ partNumber: p.partNumber, etag: p.etag, size: p.size })),
      parts: await this.signParts(key, uploadId, missing),
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_S * 1000).toISOString(),
    };
  }

  /**
   * `POST …/media/{mediaId}/complete` (spec §4.3). tus: no-op, the provider's webhook moves the
   * asset on (idempotent). S3 multipart: `CompleteMultipartUpload` with the given parts (or the
   * stored ones when omitted) → `HEAD`: over the kind's limit → `422` and `FAILED SIZE_MISMATCH`
   * → signature of the first bytes: `415 INVALID_FILE_SIGNATURE` / `422 MEDIA_KIND_MISMATCH` and
   * `FAILED INVALID_SIGNATURE` → quota with the actual size (its own reservation excluded): `402`
   * and `FAILED QUOTA_EXCEEDED`. Every refusal deletes the object. Then `PROCESSING`, the size
   * counted (`storageUsedBytes += size`), the detected mime stored, `media.process` enqueued.
   * Audited `media.completed`.
   */
  async complete(
    ctx: CourseCtx,
    mediaId: string,
    input: CompleteUploadInput,
  ): Promise<MediaAssetView> {
    const client = tenantDb(ctx.workspaceId);
    const asset = await findMediaInScope(client, ctx, mediaId);
    if (asset.providerAssetId && !asset.storageKey) {
      return mediaView(client, asset); // tus: the provider's webhook moves the asset on.
    }
    const { key, uploadId } = this.pendingMultipart(asset);
    const parts: Part[] = input.parts
      ? input.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag, size: 0 }))
      : await this.listParts(key, uploadId);
    if (parts.length === 0) throw validationFailed('parts', 'No part was uploaded');
    try {
      await this.storage.completeMultipart(key, uploadId, parts);
    } catch (err) {
      if (errorName(err) === 'NoSuchUpload') throw uploadExpired();
      if (BAD_PARTS.has(errorName(err))) {
        throw validationFailed('parts', 'The parts do not match the uploaded ones');
      }
      throw err;
    }

    const head = await this.storage.head(key);
    if (!head) throw uploadExpired();
    const kind = asset.kind as keyof typeof MEDIA_LIMITS;
    const max = MEDIA_LIMITS[kind].maxBytes;
    if (head.sizeBytes > max) {
      await this.refuse(asset, key, 'SIZE_MISMATCH', 'size_mismatch');
      throw validationFailed('sizeBytes', `File too large for ${kind} (max ${max} bytes)`);
    }
    let detected: { mime: string };
    try {
      // An empty object has no signature (and no valid byte range): refused as unknown bytes.
      const sample =
        head.sizeBytes === 0
          ? new Uint8Array(0)
          : await this.storage.getRange(key, 0, Math.min(head.sizeBytes, SIGNATURE_BYTES) - 1);
      detected = await assertSignature(kind, asset.mimeType, sample, this.video.acceptedMimeTypes);
    } catch (err) {
      const refusal =
        err instanceof ApiError ? REFUSALS[err.code as keyof typeof REFUSALS] : undefined;
      if (refusal) await this.refuse(asset, key, refusal.reason, refusal.outcome);
      throw err;
    }

    const size = BigInt(head.sizeBytes);
    const result = await withTenantTx(ctx.workspaceId, async (tx) => {
      const usage = await this.quota.usage(tx, ctx.workspaceId, asset.id);
      const claimed = await tx.mediaAsset.updateMany({
        where: { id: asset.id, status: 'UPLOADING' },
        data: fits(usage, size)
          ? {
              status: 'PROCESSING',
              processingStartedAt: new Date(),
              sizeBytes: size,
              mimeType: detected.mime,
              uploadId: null,
            }
          : { status: 'FAILED', failureReason: 'QUOTA_EXCEEDED', uploadId: null },
      });
      if (claimed.count === 0) return { ok: false as const, error: notPending(asset) };
      if (!fits(usage, size)) return { ok: false as const, error: quotaExceeded(usage, size) };
      await this.quota.commit(tx, ctx.workspaceId, asset.id, size);
      return { ok: true as const };
    });
    if (!result.ok) {
      if (result.error.code === 'QUOTA_EXCEEDED') {
        await this.deleteObject(asset.id, key);
        mediaUploads.inc({ kind: asset.kind, outcome: 'quota_exceeded' });
      }
      throw result.error;
    }

    const job: MediaProcessJob = { mediaId: asset.id, workspaceId: ctx.workspaceId };
    await this.queue.add(QUEUES.media, MEDIA_PROCESS_JOB, job, {
      jobId: mediaProcessJobId(asset.id),
    });
    mediaUploads.inc({ kind: asset.kind, outcome: 'completed' });
    await this.audit.log({
      action: 'media.completed',
      entityType: 'MediaAsset',
      entityId: asset.id,
      before: { status: 'UPLOADING' },
      after: { status: 'PROCESSING', sizeBytes: head.sizeBytes, mimeType: detected.mime },
    });
    return mediaView(
      client,
      await client.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } }),
    );
  }

  // ---- helpers ----

  /** Opens the provider-side upload and stores its ids on the asset; the ticket. */
  private async openUpload(
    ctx: CourseCtx,
    id: string,
    input: CreateUploadInput,
    storageKey: string | null,
    expiresAt: Date,
  ): Promise<UploadTicket> {
    const db = tenantDb(ctx.workspaceId);
    if (storageKey === null) {
      const upload = await this.video.createDirectUpload({
        workspaceId: ctx.workspaceId,
        mediaId: id,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        maxBytes: MEDIA_LIMITS.VIDEO.maxBytes,
        maxDurationS: MEDIA_LIMITS.VIDEO.maxDurationS,
        ttlS: UPLOAD_URL_TTL_S,
      });
      if (upload.mode === 'TUS') {
        await db.mediaAsset.update({
          where: { id },
          data: { providerAssetId: upload.providerAssetId, uploadUrlExpiresAt: upload.expiresAt },
        });
        return {
          mode: 'TUS',
          mediaId: id,
          uploadUrl: upload.uploadUrl,
          expiresAt: upload.expiresAt.toISOString(),
        };
      }
      await db.mediaAsset.update({
        where: { id },
        data: { storageKey: upload.storageKey, uploadId: upload.uploadId },
      });
      return this.multipartTicket(
        id,
        input.sizeBytes,
        upload.storageKey,
        upload.uploadId,
        expiresAt,
      );
    }
    const { uploadId } = await this.storage.createMultipartUpload(storageKey, input.mimeType);
    await db.mediaAsset.update({ where: { id }, data: { uploadId } });
    return this.multipartTicket(id, input.sizeBytes, storageKey, uploadId, expiresAt);
  }

  private async multipartTicket(
    mediaId: string,
    sizeBytes: number,
    key: string,
    uploadId: string,
    expiresAt: Date,
  ): Promise<UploadTicket> {
    const count = partCount(sizeBytes, UPLOAD_PART_SIZE_BYTES);
    const numbers = Array.from(
      { length: Math.min(count, UPLOAD_PARTS_PER_BATCH) },
      (_, i) => i + 1,
    );
    return {
      mode: 'S3_MULTIPART',
      mediaId,
      partSizeBytes: UPLOAD_PART_SIZE_BYTES,
      partCount: count,
      parts: await this.signParts(key, uploadId, numbers),
      expiresAt: expiresAt.toISOString(),
    };
  }

  private signParts(key: string, uploadId: string, numbers: number[]) {
    return Promise.all(
      numbers.map(async (partNumber) => ({
        partNumber,
        url: await this.storage.signPartUrl(key, uploadId, partNumber, UPLOAD_URL_TTL_S),
      })),
    );
  }

  /** The key and upload id of a live S3 multipart upload, else `409` / `410`. */
  private pendingMultipart(asset: MediaAsset): { key: string; uploadId: string } {
    if (asset.status !== 'UPLOADING') throw notPending(asset);
    if (!asset.storageKey || !asset.uploadId) {
      throw notPending(asset, asset.providerAssetId ? 'TUS' : undefined);
    }
    if (isAbandoned(asset)) throw uploadExpired();
    return { key: asset.storageKey, uploadId: asset.uploadId };
  }

  private async listParts(key: string, uploadId: string): Promise<Part[]> {
    try {
      return await this.storage.listParts(key, uploadId);
    } catch (err) {
      if (errorName(err) === 'NoSuchUpload') throw uploadExpired();
      throw err;
    }
  }

  /** A refused object: deleted, and its asset `FAILED` (no longer reserved, nothing counted). */
  private async refuse(
    asset: MediaAsset,
    key: string,
    reason: MediaFailureReason,
    outcome: string,
  ): Promise<void> {
    await tenantDb(asset.workspaceId).mediaAsset.updateMany({
      where: { id: asset.id, status: 'UPLOADING' },
      data: { status: 'FAILED', failureReason: reason, uploadId: null },
    });
    await this.deleteObject(asset.id, key);
    mediaUploads.inc({ kind: asset.kind, outcome });
    this.logger.info({ mediaId: asset.id, reason }, 'media.upload_refused');
  }

  /** Deletes a refused object; a failure is logged (the asset is FAILED either way). */
  private async deleteObject(mediaId: string, key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (err) {
      this.logger.error(
        { mediaId, err: { type: errorName(err) || typeof err } },
        'media.object_delete_failed',
      );
    }
  }
}
