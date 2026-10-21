import { z } from 'zod';
import { COURSE_STATUSES } from './course-constants';
import {
  MEDIA_FAILURE_REASONS,
  MEDIA_KINDS,
  MEDIA_LIMITS,
  MEDIA_MIME_TYPES,
  MEDIA_PROVIDERS,
  MEDIA_STATUSES,
  UPLOADABLE_MEDIA_KINDS,
} from './media-constants';

export const MEDIA_PAGE_MAX = 100;
export const MEDIA_PAGE_DEFAULT = 50;

/**
 * `POST /workspaces/{wid}/media/uploads` (`course.media.manage`, verified teacher): the declared
 * size within the kind's limit (D-P15) and the declared mime in the kind's allow-list. The
 * provider may narrow the VIDEO list (S3: mp4/webm) and the signature decides at `complete`.
 */
export const CreateUploadSchema = z
  .object({
    kind: z.enum(UPLOADABLE_MEDIA_KINDS),
    filename: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().toLowerCase().min(1).max(100),
    sizeBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .superRefine((v, ctx) => {
    const max = MEDIA_LIMITS[v.kind].maxBytes;
    if (v.sizeBytes > max) {
      ctx.addIssue({
        code: 'custom',
        path: ['sizeBytes'],
        message: `File too large for ${v.kind} (max ${max} bytes)`,
        params: { reason: 'PAYLOAD_TOO_LARGE', maxBytes: max },
      });
    }
    if (!MEDIA_MIME_TYPES[v.kind].includes(v.mimeType)) {
      ctx.addIssue({
        code: 'custom',
        path: ['mimeType'],
        message: `Type ${v.mimeType} not accepted for ${v.kind}`,
        params: { reason: 'UNSUPPORTED_MEDIA_TYPE', accepted: MEDIA_MIME_TYPES[v.kind] },
      });
    }
  });

export type CreateUploadInput = z.infer<typeof CreateUploadSchema>;

const PartUrlSchema = z.object({ partNumber: z.number().int().min(1), url: z.string() });

/** The upload ticket: S3 multipart (presigned part URLs, first batch) or a tus endpoint. */
export const UploadTicketSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('S3_MULTIPART'),
    mediaId: z.string(),
    partSizeBytes: z.number().int(),
    partCount: z.number().int(),
    parts: z.array(PartUrlSchema),
    expiresAt: z.string(),
  }),
  z.object({
    mode: z.literal('TUS'),
    mediaId: z.string(),
    uploadUrl: z.string(),
    expiresAt: z.string(),
  }),
]);

export type UploadTicket = z.infer<typeof UploadTicketSchema>;

/**
 * `GET …/media/{mediaId}/upload` (resume, S3 multipart only): the parts already stored and fresh
 * URLs for the missing ones.
 */
export const UploadStateSchema = z.object({
  mediaId: z.string(),
  mode: z.literal('S3_MULTIPART'),
  partSizeBytes: z.number().int(),
  partCount: z.number().int(),
  uploaded: z.array(
    z.object({ partNumber: z.number().int(), etag: z.string(), size: z.number().int() }),
  ),
  parts: z.array(PartUrlSchema),
  expiresAt: z.string(),
});

export type UploadState = z.infer<typeof UploadStateSchema>;

/** `POST …/media/{mediaId}/complete`: the part ETags (S3 multipart) or `{}` (tus). */
export const CompleteUploadSchema = z
  .object({
    parts: z
      .array(
        z
          .object({
            partNumber: z.number().int().min(1).max(10_000),
            etag: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(10_000)
      .optional(),
  })
  .strict();

export type CompleteUploadInput = z.infer<typeof CompleteUploadSchema>;

/** One asset of the media library. `sizeBytes` is a decimal string (beyond 2^53). */
export const MediaAssetSchema = z.object({
  id: z.string(),
  kind: z.enum(MEDIA_KINDS),
  provider: z.enum(MEDIA_PROVIDERS),
  status: z.enum(MEDIA_STATUSES),
  failureReason: z.enum(MEDIA_FAILURE_REASONS).nullable(),
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.string(),
  durationS: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  pageCount: z.number().int().nullable(),
  thumbnailUrl: z.string().nullable(),
  ownerUserId: z.string(),
  uploadUrlExpiresAt: z.string().nullable(),
  readyAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  usedBy: z.array(
    z.object({
      lessonId: z.string(),
      lessonTitle: z.string(),
      courseId: z.string(),
      courseTitle: z.string(),
      courseStatus: z.enum(COURSE_STATUSES),
    }),
  ),
});

export type MediaAssetView = z.infer<typeof MediaAssetSchema>;

/** `GET /workspaces/{wid}/media` (own scope → the caller's assets). */
export const MediaQuerySchema = z.object({
  kind: z.enum(MEDIA_KINDS).optional(),
  status: z.enum(MEDIA_STATUSES).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MEDIA_PAGE_MAX).default(MEDIA_PAGE_DEFAULT),
});

export type MediaQuery = z.infer<typeof MediaQuerySchema>;

export const MediaPageSchema = z.object({
  items: z.array(MediaAssetSchema),
  nextCursor: z.string().nullable(),
});

export type MediaPage = z.infer<typeof MediaPageSchema>;

/**
 * A playback grant (D-O8): video `HLS` (Cloudflare signed manifest) or `MP4` (S3 presigned GET),
 * 2 h; PDF inline URL, 5 min. Bearer secrets: never logged.
 */
export const PlaybackSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('HLS'), url: z.string(), expiresAt: z.string() }),
  z.object({ kind: z.literal('MP4'), url: z.string(), expiresAt: z.string() }),
  z.object({
    kind: z.literal('PDF'),
    url: z.string(),
    expiresAt: z.string(),
    allowDownload: z.boolean(),
  }),
]);

export type Playback = z.infer<typeof PlaybackSchema>;

/** `GET …/download` (PDF, `allowDownload`): 5-min `attachment` URL. */
export const DownloadSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
  filename: z.string(),
});

export type Download = z.infer<typeof DownloadSchema>;
