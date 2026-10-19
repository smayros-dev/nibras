import { PLAYBACK_TTL_S, S3_VIDEO_MIME_TYPES } from '@nibras/contracts';

import { storageKeyFor } from '../storage/keys';
import type { StorageProvider } from '../storage/types';
import { NotMp4Error, probeMp4 } from './mp4-probe';
import {
  assertUploadAccepted,
  type CreateDirectUploadInput,
  type DirectUpload,
  type PlaybackGrant,
  type VideoAssetInfo,
  type VideoAssetRef,
  type VideoProvider,
  type WebhookRequest,
  type WebhookVerification,
} from './types';

export interface S3VideoProviderOptions {
  /** Default playback URL lifetime (D-O8: 2 h). */
  playbackTtlS?: number;
  now?: () => Date;
}

function requireKey(ref: VideoAssetRef): string {
  if (!ref.storageKey) throw new Error('S3VideoProvider needs a storageKey');
  return ref.storageKey;
}

/**
 * Passthrough video provider (default, `VIDEO_PROVIDER=s3`; spec §6): the video is stored as
 * uploaded in our bucket and played progressively (`<video>`), no transcoding, no HLS, no
 * thumbnail, no webhooks. MP4 metadata comes from `probeMp4`; WebM reports `null`s (owner Q6).
 */
export class S3VideoProvider implements VideoProvider {
  readonly name = 'S3' as const;
  readonly acceptedMimeTypes: readonly string[] = S3_VIDEO_MIME_TYPES;
  private readonly playbackTtlS: number;
  private readonly now: () => Date;

  constructor(
    private readonly storage: StorageProvider,
    options: S3VideoProviderOptions = {},
  ) {
    this.playbackTtlS = options.playbackTtlS ?? PLAYBACK_TTL_S;
    this.now = options.now ?? (() => new Date());
  }

  async createDirectUpload(input: CreateDirectUploadInput): Promise<DirectUpload> {
    assertUploadAccepted(this.acceptedMimeTypes, input);
    const storageKey = storageKeyFor({
      workspaceId: input.workspaceId,
      kind: 'VIDEO',
      mediaId: input.mediaId,
      filename: input.filename,
    });
    const { uploadId } = await this.storage.createMultipartUpload(
      storageKey,
      input.mimeType.trim().toLowerCase(),
    );
    return {
      mode: 'S3_MULTIPART',
      storageKey,
      uploadId,
      expiresAt: new Date(this.now().getTime() + input.ttlS * 1000),
    };
  }

  /**
   * `READY` with the probed numbers once the object exists (the multipart upload is completed by
   * the API before the job runs); a missing object is `FAILED PROVIDER_ERROR`, an object labelled
   * MP4 without an `ftyp` is `FAILED INVALID_SIGNATURE`. The max-duration rule is the caller's.
   */
  async getAsset(ref: VideoAssetRef): Promise<VideoAssetInfo> {
    const key = requireKey(ref);
    const head = await this.storage.head(key);
    if (!head) return { status: 'FAILED', failureReason: 'PROVIDER_ERROR' };
    const meta = {
      durationS: null as number | null,
      width: null as number | null,
      height: null as number | null,
    };
    if (head.contentType?.toLowerCase() === 'video/mp4') {
      try {
        const probe = await probeMp4((s, e) => this.storage.getRange(key, s, e), head.sizeBytes);
        meta.durationS = probe.durationS;
        meta.width = probe.width;
        meta.height = probe.height;
      } catch (error) {
        if (error instanceof NotMp4Error) {
          return { status: 'FAILED', failureReason: 'INVALID_SIGNATURE' };
        }
        throw error;
      }
    }
    return { status: 'READY', ...meta, sizeBytes: head.sizeBytes };
  }

  async signPlayback(ref: VideoAssetRef, options: { ttlS?: number } = {}): Promise<PlaybackGrant> {
    const ttlS = options.ttlS ?? this.playbackTtlS;
    const url = await this.storage.signGetUrl(requireKey(ref), ttlS, { disposition: 'inline' });
    return { kind: 'MP4', url, expiresAt: new Date(this.now().getTime() + ttlS * 1000) };
  }

  async delete(ref: VideoAssetRef): Promise<void> {
    if (ref.storageKey) await this.storage.delete(ref.storageKey);
  }

  verifyWebhook(_req: WebhookRequest): WebhookVerification {
    return { ok: false, reason: 'NO_WEBHOOKS' };
  }
}
