/** One uploaded part of a multipart upload (`etag` exactly as the store returned it, quotes included). */
export interface Part {
  partNumber: number;
  etag: string;
  size: number;
}

export interface SignGetOptions {
  disposition: 'inline' | 'attachment';
  /** Download name (any Unicode): sent as an ASCII fallback plus RFC 5987 `filename*`. */
  filename?: string;
  /** Overrides the stored Content-Type in the response. */
  contentType?: string;
}

export interface StorageObjectInfo {
  sizeBytes: number;
  contentType: string | null;
}

/**
 * Object storage behind the media pipeline (spec §6, PRD §13.4): S3 (MinIO locally/CI, OVH
 * Object Storage in production) or the in-memory fake. Keys come from `storageKeyFor`. Presigned
 * URLs are bearer secrets: never log them.
 */
export interface StorageProvider {
  createMultipartUpload(key: string, mimeType: string): Promise<{ uploadId: string }>;
  /** Presigned PUT URL for one part, valid `ttlS` seconds. */
  signPartUrl(key: string, uploadId: string, partNumber: number, ttlS: number): Promise<string>;
  /** Uploaded parts in part-number order; throws when the upload does not exist (aborted/completed). */
  listParts(key: string, uploadId: string): Promise<Part[]>;
  completeMultipart(key: string, uploadId: string, parts: readonly Part[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  /** `null` when the object does not exist. */
  head(key: string): Promise<StorageObjectInfo | null>;
  /** Bytes `start..end` inclusive (HTTP Range semantics); `StorageObjectMissingError` when absent. */
  getRange(key: string, start: number, end: number): Promise<Uint8Array>;
  /** Presigned GET URL, valid `ttlS` seconds. */
  signGetUrl(key: string, ttlS: number, options: SignGetOptions): Promise<string>;
  /** Idempotent: deleting a missing key succeeds. */
  delete(key: string): Promise<void>;
}

export class StorageObjectMissingError extends Error {
  constructor(readonly key: string) {
    super(`Storage object not found: ${key}`);
    this.name = 'StorageObjectMissingError';
  }
}
