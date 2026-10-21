import type { UploadState } from '@nibras/contracts';
import { describe, expect, it, vi } from 'vitest';
import { loadRecord, saveRecord } from './resume-store';
import { MultipartError, uploadS3Multipart } from './s3-multipart';

class MemoryStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

/** 20 bytes in parts of 8 → 3 parts (8, 8, 4). */
const file = new Blob(['abcdefgh', 'ijklmnop', 'qrst']);
const url = (n: number, batch = 'a') => `http://minio.test/b/key?partNumber=${n}&sig=${batch}`;
const ticket = {
  mediaId: 'm1',
  partSizeBytes: 8,
  partCount: 3,
  parts: [1, 2, 3].map((n) => ({ partNumber: n, url: url(n) })),
};

function state(extra: Partial<UploadState> = {}): UploadState {
  return {
    mediaId: 'm1',
    mode: 'S3_MULTIPART',
    partSizeBytes: 8,
    partCount: 3,
    uploaded: [],
    parts: [1, 2, 3].map((n) => ({ partNumber: n, url: url(n, 'b') })),
    expiresAt: '2026-10-21T12:00:00.000Z',
    ...extra,
  };
}

const ok = (etag: string | null) =>
  new Response(null, { status: 200, headers: etag === null ? {} : { ETag: etag } });

function setup(storage = new MemoryStorage()) {
  saveRecord(
    {
      mediaId: 'm1',
      wid: 'w1',
      kind: 'PDF',
      fileName: 'f.pdf',
      size: 20,
      lastModified: 1,
      done: [],
      partCount: 3,
    },
    storage,
  );
  const sizes: Record<string, number> = {};
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    const n = Number(new URL(u).searchParams.get('partNumber'));
    sizes[u] = (init?.body as Blob).size;
    expect(init?.method).toBe('PUT');
    return ok(`"etag-${n}"`);
  });
  return { storage, fetchMock, sizes, sleep: vi.fn(async () => {}) };
}

describe('uploadS3Multipart', () => {
  it('uploads every part, returns the ETags in order and persists the done parts', async () => {
    const { storage, fetchMock, sizes, sleep } = setup();
    const onProgress = vi.fn();
    const fetchState = vi.fn();
    const parts = await uploadS3Multipart({
      file,
      ticket,
      fetchState,
      onProgress,
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
      storage,
    });
    expect(parts).toEqual([
      { partNumber: 1, etag: '"etag-1"' },
      { partNumber: 2, etag: '"etag-2"' },
      { partNumber: 3, etag: '"etag-3"' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(Object.values(sizes).sort()).toEqual([4, 8, 8]);
    expect(fetchState).not.toHaveBeenCalled();
    expect(loadRecord('m1', storage)?.done).toEqual([1, 2, 3]);
    expect(onProgress).toHaveBeenLastCalledWith(20, 20);
  });

  it('resumes: skips the stored parts and asks fetchState for the missing URLs', async () => {
    const { storage, fetchMock, sleep } = setup();
    const resumed = state({
      uploaded: [{ partNumber: 1, etag: '"stored-1"', size: 8 }],
      parts: [2, 3].map((n) => ({ partNumber: n, url: url(n, 'b') })),
    });
    const parts = await uploadS3Multipart({
      file,
      ticket: { mediaId: 'm1', partSizeBytes: 8, partCount: 3, parts: [] },
      state: resumed,
      fetchState: vi.fn(async () => resumed),
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
      storage,
    });
    expect(parts.map((p) => p.etag)).toEqual(['"stored-1"', '"etag-2"', '"etag-3"']);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('partNumber=1'))).toBe(false);
    expect(urls.every((u) => u.endsWith('sig=b'))).toBe(true);
  });

  it('refreshes the URLs through fetchState when the batch is exhausted or stale', async () => {
    const { storage, fetchMock, sleep } = setup();
    let clock = 0;
    const fetchState = vi.fn(async () => state());
    await uploadS3Multipart({
      file,
      // Only part 1 signed in the ticket: parts 2 and 3 need a fresh batch.
      ticket: { ...ticket, parts: [{ partNumber: 1, url: url(1) }] },
      fetchState,
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
      storage,
      now: () => clock,
      concurrency: 1,
    });
    expect(fetchState).toHaveBeenCalledTimes(1);

    clock = 0;
    const late = vi.fn(async () => state());
    const fetch2 = vi.fn(async (input: RequestInfo | URL) => {
      clock += 51 * 60 * 1000; // each PUT takes 51 minutes
      return ok(`"e-${new URL(String(input)).searchParams.get('partNumber')}"`);
    });
    await uploadS3Multipart({
      file,
      ticket,
      fetchState: late,
      fetch: fetch2 as unknown as typeof fetch,
      sleep,
      storage,
      now: () => clock,
      concurrency: 1,
    });
    expect(late).toHaveBeenCalled();
    expect(String(fetch2.mock.calls[1]?.[0])).toContain('sig=b');
  });

  it('retries a failed PUT with backoff, then gives up after three retries', async () => {
    const { storage, sleep } = setup();
    let failures = 2;
    const flaky = vi.fn(async (input: RequestInfo | URL) => {
      const n = new URL(String(input)).searchParams.get('partNumber');
      if (n === '2' && failures-- > 0) throw new TypeError('Failed to fetch');
      return ok(`"etag-${n}"`);
    });
    const parts = await uploadS3Multipart({
      file,
      ticket,
      fetchState: vi.fn(async () => state()),
      fetch: flaky as unknown as typeof fetch,
      sleep,
      storage,
    });
    expect(parts).toHaveLength(3);
    expect(flaky).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(2);

    const down = vi.fn(async () => new Response(null, { status: 500 }));
    await expect(
      uploadS3Multipart({
        file,
        ticket,
        fetchState: vi.fn(async () => state()),
        fetch: down as unknown as typeof fetch,
        sleep,
        storage,
        concurrency: 1,
      }),
    ).rejects.toMatchObject({ code: 'PART_FAILED' });
    expect(down).toHaveBeenCalledTimes(4);
  });

  it('surfaces a PUT without a readable ETag as a CORS hint', async () => {
    const { storage, sleep } = setup();
    const noEtag = vi.fn(async () => ok(null));
    const error = await uploadS3Multipart({
      file,
      ticket,
      fetchState: vi.fn(async () => state()),
      fetch: noEtag as unknown as typeof fetch,
      sleep,
      storage,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MultipartError);
    expect(error).toMatchObject({ code: 'CORS_ETAG' });
    expect((error as Error).message).toMatch(/CORS: ETag not exposed/);
  });

  it('stops on abort', async () => {
    const { storage, fetchMock, sleep } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadS3Multipart({
        file,
        ticket,
        signal: controller.signal,
        fetchState: vi.fn(async () => state()),
        fetch: fetchMock as unknown as typeof fetch,
        sleep,
        storage,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
