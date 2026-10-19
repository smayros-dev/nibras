import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { storageContract } from './contract';
import { storageKeyFor } from './keys';
import { createS3StorageProviderFromEnv, type S3StorageProvider } from './s3';

// Real MinIO (spec D10), bucket `<S3_BUCKET_TEST base>-providers-test` (test-setup.ts). Skipped
// where S3_ENDPOINT is unset (the windows-check CI job has no Docker).
describe.skipIf(!process.env.S3_ENDPOINT)('S3StorageProvider (MinIO)', () => {
  const wid = randomUUID();
  const keyFor = (name: string) =>
    storageKeyFor({ workspaceId: wid, kind: 'FILE', mediaId: randomUUID(), filename: name });
  let s3: S3StorageProvider;

  beforeAll(async () => {
    s3 = createS3StorageProviderFromEnv({ ...process.env, S3_BUCKET: process.env.S3_BUCKET_TEST });
    await s3.ensureBucket();
    await s3.emptyBucket();
  });
  afterAll(async () => {
    await s3?.emptyBucket();
  });

  const putPart = async (url: string, body: Uint8Array) => {
    const res = await fetch(url, { method: 'PUT', body });
    expect(res.status).toBe(200);
    return res.headers.get('etag')!;
  };

  storageContract(() => s3, putPart, keyFor);

  it('uses the test bucket derived for this package', () => {
    expect(process.env.S3_BUCKET_TEST).toMatch(/-providers-test$/);
    expect(s3.bucket).toBe(process.env.S3_BUCKET_TEST);
  });

  it('signGetUrl sets Content-Disposition inline/attachment; an expired URL is refused', async () => {
    const key = keyFor('note.pdf');
    const { uploadId } = await s3.createMultipartUpload(key, 'application/pdf');
    const etag = await putPart(
      await s3.signPartUrl(key, uploadId, 1, 60),
      new TextEncoder().encode('%PDF-1.7'),
    );
    await s3.completeMultipart(key, uploadId, [{ partNumber: 1, etag, size: 8 }]);

    const inline = await fetch(await s3.signGetUrl(key, 60, { disposition: 'inline' }));
    expect(inline.status).toBe(200);
    expect(inline.headers.get('content-disposition')).toBe('inline');
    expect(await inline.text()).toBe('%PDF-1.7');

    const attachment = await fetch(
      await s3.signGetUrl(key, 60, {
        disposition: 'attachment',
        filename: 'Cours été "1".pdf',
        contentType: 'application/pdf',
      }),
    );
    expect(attachment.status).toBe(200);
    expect(attachment.headers.get('content-type')).toBe('application/pdf');
    expect(attachment.headers.get('content-disposition')).toBe(
      `attachment; filename="Cours_ete_1_.pdf"; filename*=UTF-8''Cours%20%C3%A9t%C3%A9%20%221%22.pdf`,
    );

    const expiring = await s3.signGetUrl(key, 1, { disposition: 'inline' });
    await new Promise((r) => setTimeout(r, 2_100));
    expect((await fetch(expiring)).status).toBe(403);
  });

  it('putBucketCors applies the browser upload rule, or reports MinIO NotImplemented', async () => {
    const result = await s3.putBucketCors(['http://localhost:3000']);
    expect(['applied', 'not-implemented']).toContain(result);
    if (result === 'applied') {
      expect(await s3.getBucketCors()).toEqual([
        {
          AllowedOrigins: ['http://localhost:3000'],
          AllowedMethods: ['GET', 'PUT', 'HEAD'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3600,
        },
      ]);
    }
  });

  it('listParts follows the pagination', async () => {
    const key = keyFor('many.bin');
    const { uploadId } = await s3.createMultipartUpload(key, 'application/octet-stream');
    for (const n of [1, 2, 3]) {
      await putPart(await s3.signPartUrl(key, uploadId, n, 60), new Uint8Array([n]));
    }
    expect((await s3.listParts(key, uploadId, 2)).map((p) => p.partNumber)).toEqual([1, 2, 3]);
    await s3.abortMultipart(key, uploadId);
  });

  it('emptyBucket removes objects and aborts pending multipart uploads', async () => {
    const key = keyFor('pending.bin');
    const { uploadId } = await s3.createMultipartUpload(key, 'application/octet-stream');
    await s3.emptyBucket();
    await expect(s3.listParts(key, uploadId)).rejects.toThrow();
  });

  it('presigns against S3_PUBLIC_ENDPOINT when set, operates against S3_ENDPOINT', async () => {
    const pub = createS3StorageProviderFromEnv({
      ...process.env,
      S3_BUCKET: process.env.S3_BUCKET_TEST,
      S3_PUBLIC_ENDPOINT: 'https://media.example.test',
    });
    const key = keyFor('x.pdf');
    const url = new URL(await pub.signGetUrl(key, 60, { disposition: 'inline' }));
    expect(url.origin).toBe('https://media.example.test');
    expect(await pub.head(key)).toBeNull(); // operations still reach MinIO
  });
});
