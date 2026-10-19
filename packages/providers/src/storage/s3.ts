import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetBucketCorsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutBucketCorsCommand,
  S3Client,
  type CORSRule,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { sanitizeFilename } from '@nibras/contracts';

import {
  StorageObjectMissingError,
  type Part,
  type SignGetOptions,
  type StorageObjectInfo,
  type StorageProvider,
} from './types';

export interface S3StorageProviderOptions {
  /** Endpoint the API/worker reach (e.g. `http://minio:9000`). */
  endpoint: string;
  /** Endpoint browsers reach, used for presigned URLs only; defaults to `endpoint`. */
  publicEndpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** `true` for MinIO (`http://host/bucket/key`); OVH accepts both. */
  forcePathStyle: boolean;
}

const LIST_PARTS_PAGE = 1000;

/** RFC 5987 `filename*` value: percent-encodes everything outside attr-char. */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `inline`, or `attachment; filename="<ASCII>"; filename*=UTF-8''<encoded>`. */
export function contentDisposition(options: SignGetOptions): string {
  if (!options.filename) return options.disposition;
  return `${options.disposition}; filename="${sanitizeFilename(options.filename)}"; filename*=UTF-8''${rfc5987(options.filename)}`;
}

function isNotFound(error: unknown): boolean {
  if (!(error instanceof S3ServiceException)) return false;
  return (
    error.name === 'NotFound' ||
    error.name === 'NoSuchKey' ||
    error.$metadata?.httpStatusCode === 404
  );
}

/**
 * `StorageProvider` over S3 (MinIO locally and in CI, OVH Object Storage in production). Two
 * clients when `publicEndpoint` differs from `endpoint`: operations go to the internal endpoint,
 * presigned URLs carry the public one (the signature covers the host).
 */
export class S3StorageProvider implements StorageProvider {
  readonly bucket: string;
  private readonly client: S3Client;
  private readonly presignClient: S3Client;

  constructor(options: S3StorageProviderOptions) {
    this.bucket = options.bucket;
    const make = (endpoint: string) =>
      new S3Client({
        endpoint,
        region: options.region,
        forcePathStyle: options.forcePathStyle,
        credentials: {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
        },
        // Browsers PUT the parts without SDK checksum headers, and MinIO/OVH do not need them:
        // only send/verify checksums where the S3 API requires one (DeleteObjects).
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    this.client = make(options.endpoint);
    this.presignClient =
      options.publicEndpoint && options.publicEndpoint !== options.endpoint
        ? make(options.publicEndpoint)
        : this.client;
  }

  async createMultipartUpload(key: string, mimeType: string): Promise<{ uploadId: string }> {
    const res = await this.client.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: mimeType }),
    );
    if (!res.UploadId) throw new Error('CreateMultipartUpload returned no UploadId');
    return { uploadId: res.UploadId };
  }

  signPartUrl(key: string, uploadId: string, partNumber: number, ttlS: number): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: ttlS },
    );
  }

  /** `pageSize` is exposed for the pagination test; S3 caps a page at 1000 parts. */
  async listParts(key: string, uploadId: string, pageSize = LIST_PARTS_PAGE): Promise<Part[]> {
    const parts: Part[] = [];
    let marker: string | undefined;
    for (;;) {
      const res = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MaxParts: pageSize,
          PartNumberMarker: marker,
        }),
      );
      for (const p of res.Parts ?? []) {
        parts.push({ partNumber: p.PartNumber!, etag: p.ETag!, size: p.Size ?? 0 });
      }
      if (!res.IsTruncated || !res.NextPartNumberMarker) break;
      marker = res.NextPartNumberMarker;
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipart(key: string, uploadId: string, parts: readonly Part[]): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
    );
  }

  async head(key: string): Promise<StorageObjectInfo | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async getRange(key: string, start: number, end: number): Promise<Uint8Array> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${end}` }),
      );
      if (!res.Body) return new Uint8Array(0);
      return await res.Body.transformToByteArray();
    } catch (error) {
      if (isNotFound(error)) throw new StorageObjectMissingError(key);
      throw error;
    }
  }

  signGetUrl(key: string, ttlS: number, options: SignGetOptions): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(options),
        ResponseContentType: options.contentType,
      }),
      { expiresIn: ttlS },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Ops/test helper: creates the bucket, tolerating one this account already owns. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (error instanceof S3ServiceException && error.name === 'BucketAlreadyOwnedByYou') return;
      throw error;
    }
  }

  /**
   * Ops helper (`s3:init`): lets the browser `PUT` presigned parts and read the `ETag` from
   * `origins`. MinIO answers `NotImplemented` (it allows any origin by default) → `'not-implemented'`.
   */
  async putBucketCors(origins: readonly string[]): Promise<'applied' | 'not-implemented'> {
    try {
      await this.client.send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: [...origins],
                AllowedMethods: ['GET', 'PUT', 'HEAD'],
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
      return 'applied';
    } catch (error) {
      if (error instanceof S3ServiceException && error.name === 'NotImplemented') {
        return 'not-implemented';
      }
      throw error;
    }
  }

  /** Ops helper: the bucket's CORS rules (`[]` when none is set). */
  async getBucketCors(): Promise<CORSRule[]> {
    try {
      const res = await this.client.send(new GetBucketCorsCommand({ Bucket: this.bucket }));
      return (res.CORSRules ?? []).map(({ ID: _id, ...rule }) => rule);
    } catch (error) {
      if (error instanceof S3ServiceException && error.name === 'NoSuchCORSConfiguration')
        return [];
      throw error;
    }
  }

  /** Test helper: deletes every object (pages of 1000) and aborts every pending multipart upload. */
  async emptyBucket(): Promise<void> {
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, ContinuationToken: token, MaxKeys: 1000 }),
      );
      const keys = (res.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys, Quiet: true },
          }),
        );
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);

    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    for (;;) {
      const res = await this.client.send(
        new ListMultipartUploadsCommand({
          Bucket: this.bucket,
          KeyMarker: keyMarker,
          UploadIdMarker: uploadIdMarker,
        }),
      );
      for (const u of res.Uploads ?? []) {
        if (u.Key && u.UploadId) await this.abortMultipart(u.Key, u.UploadId);
      }
      if (!res.IsTruncated) break;
      keyMarker = res.NextKeyMarker;
      uploadIdMarker = res.NextUploadIdMarker;
    }
  }
}

/** The `S3_*` variables read by `createS3StorageProviderFromEnv`. */
export type S3Env = Partial<
  Record<
    | 'S3_ENDPOINT'
    | 'S3_PUBLIC_ENDPOINT'
    | 'S3_REGION'
    | 'S3_ACCESS_KEY'
    | 'S3_SECRET_KEY'
    | 'S3_BUCKET'
    | 'S3_FORCE_PATH_STYLE',
    string | undefined
  >
>;

/**
 * Builds the provider from `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT` (empty = `S3_ENDPOINT`),
 * `S3_REGION` (default `us-east-1`), `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` and
 * `S3_FORCE_PATH_STYLE` (`true` unless `false`/`0`). Throws when a required one is missing.
 */
export function createS3StorageProviderFromEnv(env: S3Env): S3StorageProvider {
  const required = (name: 'S3_ENDPOINT' | 'S3_ACCESS_KEY' | 'S3_SECRET_KEY' | 'S3_BUCKET') => {
    const value = env[name];
    if (!value) throw new Error(`${name} is required for the S3 storage provider`);
    return value;
  };
  const pathStyle = (env.S3_FORCE_PATH_STYLE ?? '').trim().toLowerCase();
  return new S3StorageProvider({
    endpoint: required('S3_ENDPOINT'),
    publicEndpoint: env.S3_PUBLIC_ENDPOINT || undefined,
    region: env.S3_REGION || 'us-east-1',
    accessKeyId: required('S3_ACCESS_KEY'),
    secretAccessKey: required('S3_SECRET_KEY'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: pathStyle !== 'false' && pathStyle !== '0',
  });
}
