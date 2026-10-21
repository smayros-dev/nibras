import { createHash, randomUUID } from 'node:crypto';

import { MEDIA_MIME_TYPES, PLAYBACK_TTL_S, S3_VIDEO_MIME_TYPES } from '@nibras/contracts';

import { storageKeyFor } from '../storage/keys';
import {
  assertUploadAccepted,
  headerValue,
  type CreateDirectUploadInput,
  type DirectUpload,
  type PlaybackGrant,
  type VideoAssetInfo,
  type VideoAssetRef,
  type VideoProvider,
  type VideoWebhookEvent,
  type WebhookRequest,
  type WebhookVerification,
} from './types';

const FAKE_SIGNATURE = 'fake-valid';

/**
 * Scripted `VideoProvider` for API/worker tests (spec §6). As `CLOUDFLARE_STREAM` (default) it
 * forces the TUS path; `assets` scripts `getAsset` (unknown ids are `PROCESSING`); `nextWebhook`
 * builds a request `verifyWebhook` accepts (same body → same `eventId`, for replay tests).
 */
export class FakeVideoProvider implements VideoProvider {
  readonly name: 'S3' | 'CLOUDFLARE_STREAM';
  readonly acceptedMimeTypes: readonly string[];
  readonly uploads: DirectUpload[] = [];
  readonly assets = new Map<string, VideoAssetInfo>();
  readonly deleted: string[] = [];
  private readonly now: () => Date;

  constructor(options: { name?: 'S3' | 'CLOUDFLARE_STREAM'; now?: () => Date } = {}) {
    this.name = options.name ?? 'CLOUDFLARE_STREAM';
    this.acceptedMimeTypes = this.name === 'S3' ? S3_VIDEO_MIME_TYPES : MEDIA_MIME_TYPES.VIDEO;
    this.now = options.now ?? (() => new Date());
  }

  createDirectUpload(input: CreateDirectUploadInput): Promise<DirectUpload> {
    try {
      assertUploadAccepted(this.acceptedMimeTypes, input);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    const expiresAt = new Date(this.now().getTime() + input.ttlS * 1000);
    const upload: DirectUpload =
      this.name === 'S3'
        ? {
            mode: 'S3_MULTIPART',
            storageKey: storageKeyFor({ ...input, kind: 'VIDEO' }),
            uploadId: randomUUID(),
            expiresAt,
          }
        : {
            mode: 'TUS',
            uploadUrl: `https://video.test/tus/${input.mediaId}`,
            providerAssetId: randomUUID().replaceAll('-', ''),
            expiresAt,
          };
    this.uploads.push(upload);
    return Promise.resolve(upload);
  }

  getAsset(ref: VideoAssetRef): Promise<VideoAssetInfo> {
    const id = ref.providerAssetId ?? ref.storageKey ?? '';
    return Promise.resolve(this.assets.get(id) ?? { status: 'PROCESSING' });
  }

  signPlayback(ref: VideoAssetRef, options: { ttlS?: number } = {}): Promise<PlaybackGrant> {
    const ttlS = options.ttlS ?? PLAYBACK_TTL_S;
    const nowMs = this.now().getTime();
    const id = ref.providerAssetId ?? ref.storageKey ?? '';
    return Promise.resolve({
      kind: this.name === 'S3' ? 'MP4' : 'HLS',
      url: `https://video.test/${id}?exp=${Math.floor(nowMs / 1000) + ttlS}`,
      expiresAt: new Date(nowMs + ttlS * 1000),
    });
  }

  delete(ref: VideoAssetRef): Promise<void> {
    const id = ref.providerAssetId ?? ref.storageKey;
    if (id) this.deleted.push(id);
    return Promise.resolve();
  }

  /** A webhook request carrying `events`, signed so that `verifyWebhook` accepts it. */
  nextWebhook(events: VideoWebhookEvent[]): WebhookRequest {
    return {
      rawBody: Buffer.from(JSON.stringify({ events })),
      headers: { 'webhook-signature': FAKE_SIGNATURE },
    };
  }

  verifyWebhook(req: WebhookRequest): WebhookVerification {
    if (this.name === 'S3') return { ok: false, reason: 'NO_WEBHOOKS' };
    const signature = headerValue(req.headers, 'webhook-signature');
    if (!signature) return { ok: false, reason: 'MISSING_SIGNATURE' };
    if (signature !== FAKE_SIGNATURE) return { ok: false, reason: 'INVALID_SIGNATURE' };
    try {
      const { events } = JSON.parse(req.rawBody.toString('utf8')) as {
        events: VideoWebhookEvent[];
      };
      if (!Array.isArray(events)) return { ok: false, reason: 'INVALID_PAYLOAD' };
      return { ok: true, events, eventId: createHash('sha256').update(req.rawBody).digest('hex') };
    } catch {
      return { ok: false, reason: 'INVALID_PAYLOAD' };
    }
  }
}
