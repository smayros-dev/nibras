import { expect, it } from 'vitest';

import { StorageObjectMissingError, type Part, type StorageProvider } from './types';

/**
 * Test-only: the behaviour shared by every StorageProvider, run against the in-memory fake
 * (in-memory.test.ts) and the real MinIO (s3.test.ts). `uploadPart` stands for the browser's PUT
 * on a presigned part URL and returns the ETag. Not exported from the package entry.
 */
export function storageContract(
  provider: () => StorageProvider,
  uploadPart: (url: string, body: Uint8Array) => Promise<string>,
  keyFor: (name: string) => string,
): void {
  it('multipart: uploaded parts are listed, completed in part order and readable by range', async () => {
    const s = provider();
    const key = keyFor('a.pdf');
    const { uploadId } = await s.createMultipartUpload(key, 'application/pdf');
    const part1 = new Uint8Array(5 * 1024 * 1024).fill(1);
    const part2 = new TextEncoder().encode('%PDF-tail');
    const parts: Part[] = [];
    for (const [n, body] of [
      [2, part2],
      [1, part1],
    ] as const) {
      const etag = await uploadPart(await s.signPartUrl(key, uploadId, n, 60), body);
      parts.push({ partNumber: n, etag, size: body.length });
    }
    const listed = await s.listParts(key, uploadId);
    expect(listed.map((p) => p.partNumber)).toEqual([1, 2]);
    expect(listed.map((p) => p.size)).toEqual([part1.length, part2.length]);
    await s.completeMultipart(key, uploadId, parts);
    expect(await s.head(key)).toEqual({
      sizeBytes: part1.length + part2.length,
      contentType: 'application/pdf',
    });
    const tail = await s.getRange(key, part1.length, part1.length + 7);
    expect(new TextDecoder().decode(tail)).toBe('%PDF-tai');
    expect(Array.from(await s.getRange(key, 0, 3))).toEqual([1, 1, 1, 1]);
  });

  it('abortMultipart drops the parts; delete is idempotent; head of a missing key is null', async () => {
    const s = provider();
    const key = keyFor('b.bin');
    const { uploadId } = await s.createMultipartUpload(key, 'application/octet-stream');
    await uploadPart(await s.signPartUrl(key, uploadId, 1, 60), new Uint8Array([1, 2, 3]));
    await s.abortMultipart(key, uploadId);
    await expect(s.listParts(key, uploadId)).rejects.toThrow();
    expect(await s.head(key)).toBeNull();
    await s.delete(key);
    await s.delete(key);
    await expect(s.getRange(key, 0, 1)).rejects.toBeInstanceOf(StorageObjectMissingError);
  });

  it('delete removes a completed object', async () => {
    const s = provider();
    const key = keyFor('c.txt');
    const { uploadId } = await s.createMultipartUpload(key, 'text/plain');
    const etag = await uploadPart(
      await s.signPartUrl(key, uploadId, 1, 60),
      new TextEncoder().encode('hi'),
    );
    await s.completeMultipart(key, uploadId, [{ partNumber: 1, etag, size: 2 }]);
    expect((await s.head(key))?.sizeBytes).toBe(2);
    await s.delete(key);
    expect(await s.head(key)).toBeNull();
  });
}
