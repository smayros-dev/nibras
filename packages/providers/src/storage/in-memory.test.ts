import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { storageContract } from './contract';
import { InMemoryStorageProvider } from './in-memory';
import { storageKeyFor } from './keys';

const wid = randomUUID();
const keyFor = (name: string) =>
  storageKeyFor({ workspaceId: wid, kind: 'FILE', mediaId: randomUUID(), filename: name });

describe('InMemoryStorageProvider', () => {
  let s: InMemoryStorageProvider;
  beforeEach(() => {
    s = new InMemoryStorageProvider({ now: () => new Date('2026-10-19T10:00:00Z') });
  });

  storageContract(
    () => s,
    async (url, body) => s.putPart(url, body),
    keyFor,
  );

  it('signs recognisable fake URLs', async () => {
    const key = keyFor('a.pdf');
    const { uploadId } = await s.createMultipartUpload(key, 'application/pdf');
    expect(await s.signPartUrl(key, uploadId, 3, 60)).toBe(
      `https://storage.test/upload/${uploadId}/3`,
    );
    const url = new URL(
      await s.signGetUrl(key, 300, { disposition: 'attachment', filename: 'été.pdf' }),
    );
    expect(url.origin + url.pathname).toBe(`https://storage.test/${key}`);
    expect(url.searchParams.get('disposition')).toBe('attachment');
    expect(url.searchParams.get('exp')).toBe(String(Date.parse('2026-10-19T10:05:00Z') / 1000));
  });

  it('refuses a completion with a wrong etag; exposes objects for assertions', async () => {
    const key = keyFor('a.pdf');
    const { uploadId } = await s.createMultipartUpload(key, 'application/pdf');
    await s.putPart(await s.signPartUrl(key, uploadId, 1, 60), new Uint8Array([37]));
    await expect(
      s.completeMultipart(key, uploadId, [{ partNumber: 1, etag: '"nope"', size: 1 }]),
    ).rejects.toThrow(/etag/i);
    s.putObject(key, new Uint8Array([1, 2]), 'application/pdf');
    expect(s.objects.get(key)?.body).toEqual(new Uint8Array([1, 2]));
    expect(await s.head(key)).toEqual({ sizeBytes: 2, contentType: 'application/pdf' });
  });
});
