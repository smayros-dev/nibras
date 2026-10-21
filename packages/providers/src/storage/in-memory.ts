import { createHash, randomUUID } from 'node:crypto';

import {
  StorageObjectMissingError,
  type Part,
  type SignGetOptions,
  type StorageObjectInfo,
  type StorageProvider,
} from './types';

export interface StoredObject {
  body: Uint8Array;
  contentType: string;
}

interface PendingUpload {
  key: string;
  contentType: string;
  parts: Map<number, { body: Uint8Array; etag: string }>;
}

const PART_URL = /^https:\/\/storage\.test\/upload\/([^/]+)\/(\d+)$/;

const etagOf = (body: Uint8Array) => `"${createHash('md5').update(body).digest('hex')}"`;

/**
 * Same contract as `S3StorageProvider`, in memory, for service unit tests (the API and worker
 * e2e suites use the real MinIO, spec D10). `putPart` plays the browser's PUT on a part URL;
 * `objects` is exposed for assertions and `putObject` seeds one directly.
 */
export class InMemoryStorageProvider implements StorageProvider {
  readonly objects = new Map<string, StoredObject>();
  private readonly uploads = new Map<string, PendingUpload>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  createMultipartUpload(key: string, mimeType: string): Promise<{ uploadId: string }> {
    const uploadId = randomUUID();
    this.uploads.set(uploadId, { key, contentType: mimeType, parts: new Map() });
    return Promise.resolve({ uploadId });
  }

  signPartUrl(key: string, uploadId: string, partNumber: number, _ttlS: number): Promise<string> {
    this.upload(key, uploadId);
    return Promise.resolve(`https://storage.test/upload/${uploadId}/${partNumber}`);
  }

  /** The fake's PUT on a URL from `signPartUrl`; returns the part's ETag. */
  putPart(url: string, body: Uint8Array): Promise<string> {
    const match = PART_URL.exec(url);
    const upload = match ? this.uploads.get(match[1]!) : undefined;
    if (!match || !upload) return Promise.reject(new Error(`No such upload: ${url}`));
    const etag = etagOf(body);
    upload.parts.set(Number(match[2]), { body: Uint8Array.from(body), etag });
    return Promise.resolve(etag);
  }

  listParts(key: string, uploadId: string): Promise<Part[]> {
    try {
      const upload = this.upload(key, uploadId);
      return Promise.resolve(
        [...upload.parts.entries()]
          .sort(([a], [b]) => a - b)
          .map(([partNumber, p]) => ({ partNumber, etag: p.etag, size: p.body.length })),
      );
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  completeMultipart(key: string, uploadId: string, parts: readonly Part[]): Promise<void> {
    try {
      const upload = this.upload(key, uploadId);
      const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
      const bodies = ordered.map((p) => {
        const stored = upload.parts.get(p.partNumber);
        if (!stored || stored.etag !== p.etag) {
          throw new Error(`Invalid part ${p.partNumber}: unknown part or etag mismatch`);
        }
        return stored.body;
      });
      const body = new Uint8Array(bodies.reduce((n, b) => n + b.length, 0));
      let offset = 0;
      for (const b of bodies) {
        body.set(b, offset);
        offset += b.length;
      }
      this.objects.set(key, { body, contentType: upload.contentType });
      this.uploads.delete(uploadId);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  abortMultipart(_key: string, uploadId: string): Promise<void> {
    this.uploads.delete(uploadId);
    return Promise.resolve();
  }

  head(key: string): Promise<StorageObjectInfo | null> {
    const object = this.objects.get(key);
    return Promise.resolve(
      object ? { sizeBytes: object.body.length, contentType: object.contentType } : null,
    );
  }

  getRange(key: string, start: number, end: number): Promise<Uint8Array> {
    const object = this.objects.get(key);
    if (!object) return Promise.reject(new StorageObjectMissingError(key));
    return Promise.resolve(object.body.slice(start, end + 1));
  }

  signGetUrl(key: string, ttlS: number, options: SignGetOptions): Promise<string> {
    const url = new URL(`https://storage.test/${key}`);
    url.searchParams.set('disposition', options.disposition);
    if (options.filename) url.searchParams.set('filename', options.filename);
    if (options.contentType) url.searchParams.set('contentType', options.contentType);
    url.searchParams.set('exp', String(Math.floor(this.now().getTime() / 1000) + ttlS));
    return Promise.resolve(url.toString());
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  /** Seeds an object directly (tests). */
  putObject(key: string, body: Uint8Array, contentType: string): void {
    this.objects.set(key, { body: Uint8Array.from(body), contentType });
  }

  private upload(key: string, uploadId: string): PendingUpload {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.key !== key) throw new Error(`No such upload: ${uploadId}`);
    return upload;
  }
}
