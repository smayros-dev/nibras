import type { MediaFailureReason } from '@nibras/contracts';

/** Where a video lives: the provider's id (Cloudflare `uid`) or our storage key (S3 passthrough). */
export interface VideoAssetRef {
  providerAssetId?: string;
  storageKey?: string;
}

export interface CreateDirectUploadInput {
  /** Owner workspace: the S3 provider builds the storage key under it (`storageKeyFor`). */
  workspaceId: string;
  mediaId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  maxBytes: number;
  maxDurationS: number;
  /** Lifetime of the upload ticket. */
  ttlS: number;
}

/** How the browser sends the bytes (spec D1). `uploadUrl` is a bearer secret: never log it. */
export type DirectUpload =
  | { mode: 'TUS'; uploadUrl: string; providerAssetId: string; expiresAt: Date }
  | { mode: 'S3_MULTIPART'; storageKey: string; uploadId: string; expiresAt: Date };

/** Provider view of an asset; `null` metadata = unknown (WebM, no `moov`, Cloudflare `-1`). */
export interface VideoAssetInfo {
  status: 'PROCESSING' | 'READY' | 'FAILED';
  durationS?: number | null;
  width?: number | null;
  height?: number | null;
  thumbnailUrl?: string;
  sizeBytes?: number;
  failureReason?: MediaFailureReason;
  /** The provider's own error code (Cloudflare `status.errorReasonCode`), for logs. */
  providerErrorCode?: string;
}

/** A playback URL (bearer secret, D-O8): never log it. */
export interface PlaybackGrant {
  kind: 'HLS' | 'MP4';
  url: string;
  expiresAt: Date;
  /** Signed thumbnail (Cloudflare only). */
  thumbnailUrl?: string;
}

export interface VideoWebhookEvent {
  providerAssetId: string;
  state: 'READY' | 'FAILED' | 'PROCESSING';
  durationS?: number | null;
  width?: number | null;
  height?: number | null;
  thumbnailUrl?: string;
  sizeBytes?: number;
  failureReason?: MediaFailureReason;
  providerErrorCode?: string;
}

export interface WebhookRequest {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  now?: Date;
}

export type WebhookFailureReason =
  'NO_WEBHOOKS' | 'MISSING_SIGNATURE' | 'INVALID_SIGNATURE' | 'INVALID_TIME' | 'INVALID_PAYLOAD';

/** `eventId` = sha256(rawBody) hex: the idempotence key of `WebhookEvent` (spec D11). */
export type WebhookVerification =
  | { ok: true; events: VideoWebhookEvent[]; eventId: string }
  | { ok: false; reason: WebhookFailureReason };

/**
 * Video hosting behind the media pipeline (spec §6, PRD §13.4): the S3 passthrough (default,
 * dev/CI/staging) or Cloudflare Stream (`VIDEO_PROVIDER=cloudflare_stream`, D-P1).
 */
export interface VideoProvider {
  readonly name: 'S3' | 'CLOUDFLARE_STREAM';
  readonly acceptedMimeTypes: readonly string[];
  /** Throws `UnsupportedVideoError` for a mime type outside `acceptedMimeTypes` or a size over `maxBytes`. */
  createDirectUpload(input: CreateDirectUploadInput): Promise<DirectUpload>;
  getAsset(ref: VideoAssetRef): Promise<VideoAssetInfo>;
  signPlayback(ref: VideoAssetRef, options?: { ttlS?: number }): Promise<PlaybackGrant>;
  /** Idempotent. */
  delete(ref: VideoAssetRef): Promise<void>;
  verifyWebhook(req: WebhookRequest): WebhookVerification;
}

/** The provider refuses this upload (mime type or size); the API maps it to a 4xx. */
export class UnsupportedVideoError extends Error {
  constructor(
    readonly reason: 'MIME_TYPE' | 'SIZE',
    message: string,
  ) {
    super(message);
    this.name = 'UnsupportedVideoError';
  }
}

/** A provider API call failed (`status` 0 = network error / timeout). `body` is truncated. */
export class VideoProviderError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Video provider error (HTTP ${status})`);
    this.name = 'VideoProviderError';
  }
}

/** Shared guard for `createDirectUpload`. */
export function assertUploadAccepted(
  accepted: readonly string[],
  input: Pick<CreateDirectUploadInput, 'mimeType' | 'sizeBytes' | 'maxBytes'>,
): void {
  const mime = input.mimeType.trim().toLowerCase();
  if (!accepted.includes(mime)) {
    throw new UnsupportedVideoError('MIME_TYPE', `Video type not accepted: ${mime}`);
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new UnsupportedVideoError('SIZE', 'Video size must be a positive integer');
  }
  if (input.sizeBytes > input.maxBytes) {
    throw new UnsupportedVideoError('SIZE', `Video larger than ${input.maxBytes} bytes`);
  }
}

/** Case-insensitive header lookup (first value of a repeated header). */
export function headerValue(headers: WebhookRequest['headers'], name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}
