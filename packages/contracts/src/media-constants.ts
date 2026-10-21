// Zod-free (exported by `@nibras/contracts/web` for browser bundles); the schemas are in media.ts.

/** `MediaAsset.kind` (PRD §11.1; `FILE` = message attachments V2-d, `RECORDING` = V2-c). */
export const MEDIA_KINDS = ['VIDEO', 'PDF', 'IMAGE', 'FILE', 'RECORDING'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** The kinds `POST …/media/uploads` accepts (recordings come from the live provider). */
export const UPLOADABLE_MEDIA_KINDS = [
  'VIDEO',
  'PDF',
  'IMAGE',
  'FILE',
] as const satisfies readonly MediaKind[];
export type UploadableMediaKind = (typeof UPLOADABLE_MEDIA_KINDS)[number];

/** `MediaAsset.status`. */
export const MEDIA_STATUSES = ['UPLOADING', 'PROCESSING', 'READY', 'FAILED', 'DELETING'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/** `MediaAsset.provider`. */
export const MEDIA_PROVIDERS = ['CLOUDFLARE_STREAM', 'MUX', 'S3'] as const;
export type MediaProvider = (typeof MEDIA_PROVIDERS)[number];

/** `MediaAsset.failureReason`. */
export const MEDIA_FAILURE_REASONS = [
  'ABANDONED',
  'TIMEOUT',
  'PROVIDER_ERROR',
  'INVALID_SIGNATURE',
  'ENCRYPTED',
  'QUOTA_EXCEEDED',
  'SIZE_MISMATCH',
] as const;
export type MediaFailureReason = (typeof MEDIA_FAILURE_REASONS)[number];

/** How the client sends the bytes (spec D1). */
export const UPLOAD_MODES = ['S3_MULTIPART', 'TUS'] as const;
export type UploadMode = (typeof UPLOAD_MODES)[number];

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const HOUR_MS = 3600 * 1000;

/** Per-kind limits (D-P15); `maxDurationS` is checked when a video turns READY. */
export const MEDIA_LIMITS = {
  VIDEO: { maxBytes: 4 * GiB, maxDurationS: 14400 },
  PDF: { maxBytes: 50 * MiB },
  IMAGE: { maxBytes: 5 * MiB },
  FILE: { maxBytes: 10 * MiB },
} as const satisfies Record<UploadableMediaKind, { maxBytes: number; maxDurationS?: number }>;

/** Videos the S3 passthrough provider accepts: what browsers play without transcoding (Q6). */
export const S3_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'] as const;

/**
 * Declared mime allow-list per kind. VIDEO is Cloudflare Stream's wider list (it transcodes); the
 * S3 provider narrows it to `S3_VIDEO_MIME_TYPES`. The declared type is advisory: the file
 * signature decides at `complete`.
 */
export const MEDIA_MIME_TYPES: Record<MediaKind, readonly string[]> = {
  VIDEO: [...S3_VIDEO_MIME_TYPES, 'video/quicktime', 'video/x-matroska'],
  PDF: ['application/pdf'],
  IMAGE: ['image/jpeg', 'image/png', 'image/webp'],
  FILE: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  RECORDING: ['video/mp4'],
};

/** S3 multipart part size. */
export const UPLOAD_PART_SIZE_BYTES = 8 * MiB;
/** Presigned part URLs and the upload ticket live 1 h. */
export const UPLOAD_URL_TTL_S = 3600;
/** Presigned part URLs handed out per ticket / resume call. */
export const UPLOAD_PARTS_PER_BATCH = 100;
/** Video playback token (D-O8: 2 h). */
export const PLAYBACK_TTL_S = 7200;
/** Inline PDF / image URLs and downloads: 5 min. */
export const INLINE_URL_TTL_S = 300;
/** Playback tokens per user per hour (`429 RATE_LIMITED` beyond). */
export const PLAYBACK_TOKENS_PER_HOUR = 30;
/** An upload still `UPLOADING` after 24 h is abandoned. */
export const UPLOAD_ABANDON_AFTER_MS = 24 * HOUR_MS;
/** An asset still `PROCESSING` after 6 h times out (after a provider reconciliation). */
export const PROCESSING_TIMEOUT_MS = 6 * HOUR_MS;
/** Accepted clock skew of a signed webhook. */
export const WEBHOOK_TOLERANCE_S = 300;

/**
 * The kind a mime type belongs to (VIDEO, PDF, IMAGE — `FILE` and `RECORDING` are never
 * inferred), case-insensitive; `null` when no kind allows it.
 */
export function kindForMime(mime: string): MediaKind | null {
  const m = mime.trim().toLowerCase();
  for (const kind of ['VIDEO', 'PDF', 'IMAGE'] as const) {
    if (MEDIA_MIME_TYPES[kind].includes(m)) return kind;
  }
  return null;
}

/** Number of parts of an upload (at least 1). */
export function partCount(sizeBytes: number, partSize: number): number {
  return Math.max(1, Math.ceil(sizeBytes / partSize));
}

const FILENAME_MAX = 120;
const EXTENSION = /\.[A-Za-z0-9]{1,15}$/;

/**
 * An ASCII storage-key-safe file name: NFKD then diacritics dropped, every run of characters
 * outside `[A-Za-z0-9._-]` → `_`, no leading dots, at most 120 characters keeping the extension,
 * never empty (`file`).
 */
export function sanitizeFilename(name: string): string {
  let out = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '');
  if (out.length > FILENAME_MAX) {
    const ext = EXTENSION.exec(out)?.[0] ?? '';
    out = out.slice(0, FILENAME_MAX - ext.length) + ext;
  }
  return out === '' || out === '_' ? 'file' : out;
}
