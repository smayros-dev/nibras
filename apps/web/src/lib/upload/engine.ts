import type { ApiErrorBody, MediaAssetView, UploadState, UploadTicket } from '@nibras/contracts';
import type { UploadableMediaKind } from '@nibras/contracts/web';
import { api, asApiResult } from '../api';
import { clearRecord, findResumable, saveRecord, type ResumeRecord } from './resume-store';
import { MultipartError, uploadS3Multipart } from './s3-multipart';

export { findResumable };
export type { ResumeRecord };

/**
 * Why an upload stopped: an API error code (`QUOTA_EXCEEDED` 402, `INVALID_FILE_SIGNATURE` 415,
 * `MEDIA_KIND_MISMATCH` 422, `UPLOAD_EXPIRED` 410, …) with its body, `CORS_ETAG` (the bucket
 * hides the part ETags), `NETWORK` (a part kept failing; the upload can be resumed) or `ABORTED`.
 */
export class UploadError extends Error {
  constructor(
    readonly code: string,
    readonly body: ApiErrorBody | null = null,
  ) {
    super(code);
    this.name = 'UploadError';
  }
}

export interface UploadCallbacks {
  wid: string;
  kind: UploadableMediaKind;
  file: File;
  signal?: AbortSignal;
  onProgress?: (sent: number, total: number) => void;
  /** The asset id, as soon as the API has created it (cancel deletes it). */
  onStarted?: (mediaId: string) => void;
  /** The bytes are all sent; `complete` (size, signature and quota checks) is running. */
  onFinishing?: () => void;
}

const EXTENSION_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** The declared type: the browser's, else from the extension (the signature decides anyway). */
export function mimeOf(file: File): string {
  if (file.type) return file.type;
  const ext = /\.([A-Za-z0-9]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? '';
  return EXTENSION_MIME[ext] ?? 'application/octet-stream';
}

function failure(error: ApiErrorBody | undefined | null): UploadError {
  return new UploadError(error?.code ?? 'INTERNAL_ERROR', error ?? null);
}

async function call<T>(send: () => Promise<{ data?: never; error?: never }>): Promise<T> {
  let result;
  try {
    result = asApiResult<T>(await send());
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') throw new UploadError('ABORTED');
    throw new UploadError('NETWORK');
  }
  if (result.error || result.data === undefined) throw failure(result.error);
  return result.data;
}

const fetchState = (wid: string, mediaId: string) => () =>
  call<UploadState>(() =>
    api.GET('/workspaces/{wid}/media/{mediaId}/upload', { params: { path: { wid, mediaId } } }),
  );

/**
 * `complete`: the parts' ETags (S3) or `{}` (tus). A refusal (402/415/422) leaves nothing to
 * resume — the API failed or deleted the object — so the record goes too.
 */
async function complete(
  wid: string,
  mediaId: string,
  parts: { partNumber: number; etag: string }[] | undefined,
): Promise<MediaAssetView> {
  try {
    const asset = await call<MediaAssetView>(() =>
      api.POST('/workspaces/{wid}/media/{mediaId}/complete', {
        params: { path: { wid, mediaId } },
        body: parts ? { parts } : {},
      }),
    );
    clearRecord(mediaId);
    return asset;
  } catch (error) {
    if (error instanceof UploadError && error.body) clearRecord(mediaId);
    throw error;
  }
}

async function sendS3(
  input: UploadCallbacks,
  ticket: {
    mediaId: string;
    partSizeBytes: number;
    partCount: number;
    parts: { partNumber: number; url: string }[];
  },
  state?: UploadState,
): Promise<MediaAssetView> {
  let parts;
  try {
    parts = await uploadS3Multipart({
      file: input.file,
      ticket,
      state,
      signal: input.signal,
      onProgress: input.onProgress,
      fetchState: fetchState(input.wid, ticket.mediaId),
    });
  } catch (error) {
    if (error instanceof UploadError) throw error;
    if (error instanceof MultipartError && error.code === 'CORS_ETAG') {
      throw new UploadError('CORS_ETAG');
    }
    if (input.signal?.aborted || (error as { name?: string })?.name === 'AbortError') {
      throw new UploadError('ABORTED');
    }
    throw new UploadError('NETWORK');
  }
  input.onFinishing?.();
  return complete(input.wid, ticket.mediaId, parts);
}

/**
 * A new upload (spec D1): `POST …/media/uploads` (declared kind, name, type and size — `402`
 * on quota, `422` on size/type), then the bytes (S3 multipart through the presigned URLs, or tus
 * for Cloudflare Stream), then `complete`. Returns the asset (`PROCESSING`, or `READY`).
 */
export async function startUpload(input: UploadCallbacks): Promise<MediaAssetView> {
  const { wid, kind, file } = input;
  const ticket = await call<UploadTicket>(() =>
    api.POST('/workspaces/{wid}/media/uploads', {
      params: { path: { wid } },
      body: { kind, filename: file.name, mimeType: mimeOf(file), sizeBytes: file.size },
    }),
  );
  input.onStarted?.(ticket.mediaId);
  if (ticket.mode === 'TUS') {
    try {
      const { uploadTus } = await import('./tus');
      await uploadTus({
        file,
        uploadUrl: ticket.uploadUrl,
        onProgress: input.onProgress,
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal?.aborted) throw new UploadError('ABORTED');
      throw error instanceof UploadError ? error : new UploadError('NETWORK');
    }
    input.onFinishing?.();
    return complete(wid, ticket.mediaId, undefined);
  }
  saveRecord({
    mediaId: ticket.mediaId,
    wid,
    kind,
    fileName: file.name,
    size: file.size,
    lastModified: file.lastModified,
    partCount: ticket.partCount,
    done: [],
  });
  return sendS3(input, ticket);
}

/**
 * Resumes a stored S3 upload of the same file: `GET …/upload` lists the parts already stored
 * (skipped) and signs the missing ones. An upload the API no longer accepts (`410 UPLOAD_EXPIRED`,
 * `409 UPLOAD_NOT_PENDING`, `404`) drops the record; the caller starts a new one.
 */
export async function resumeUpload(
  input: UploadCallbacks & { record: ResumeRecord },
): Promise<MediaAssetView> {
  const { record } = input;
  let state: UploadState;
  try {
    state = await fetchState(input.wid, record.mediaId)();
  } catch (error) {
    if (error instanceof UploadError && error.body) clearRecord(record.mediaId);
    throw error;
  }
  input.onStarted?.(record.mediaId);
  return sendS3(
    input,
    {
      mediaId: record.mediaId,
      partSizeBytes: state.partSizeBytes,
      partCount: state.partCount,
      parts: state.parts,
    },
    state,
  );
}

/** Cancel: forget the stored state and delete the pending asset (best effort). */
export async function cancelUpload({ wid, mediaId }: { wid: string; mediaId: string }) {
  clearRecord(mediaId);
  try {
    await api.DELETE('/workspaces/{wid}/media/{mediaId}', { params: { path: { wid, mediaId } } });
  } catch {
    // The abandoned-upload sweep (24 h) removes it anyway.
  }
}
