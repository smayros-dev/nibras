import type { UploadState } from '@nibras/contracts';
import { markPartDone, type KeyValueStorage } from './resume-store';

/** A presigned part URL is refreshed once it is older than this (they live 1 h). */
const URL_MAX_AGE_MS = 50 * 60 * 1000;
/** Retries per part after the first attempt. */
const RETRIES = 3;
const BACKOFF_MS = 1000;

export type MultipartErrorCode = 'CORS_ETAG' | 'PART_FAILED';

export class MultipartError extends Error {
  constructor(
    readonly code: MultipartErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MultipartError';
  }
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface MultipartInput {
  file: Blob;
  /** The ticket's S3 fields (`parts` = the first batch of presigned URLs). */
  ticket: {
    mediaId: string;
    partSizeBytes: number;
    partCount: number;
    parts: { partNumber: number; url: string }[];
  };
  /** A resume: the parts already stored (skipped) and fresh URLs for the others. */
  state?: UploadState;
  signal?: AbortSignal;
  /** Bytes stored so far / file size, after each part. */
  onProgress?: (sent: number, total: number) => void;
  /** `GET …/media/{id}/upload`: fresh URLs for the missing parts (and the stored ones). */
  fetchState: () => Promise<UploadState>;
  concurrency?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  storage?: KeyValueStorage | null;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function abortError(): DOMException {
  return new DOMException('The upload was aborted', 'AbortError');
}

/**
 * Sends a file to S3 multipart through presigned `PUT`s (spec D1, AC-MED-01): parts of
 * `partSizeBytes`, `concurrency` (3) at a time, each retried 3 times with exponential backoff.
 * Every stored part goes to the resume store, so a reload resumes from `GET …/upload`. URLs come
 * from the ticket / resume state; when a part has none or the batch is older than 50 minutes,
 * `fetchState` signs a new batch. A `PUT` answered without a readable `ETag` cannot be completed:
 * the bucket's CORS rule must expose it (`MultipartError('CORS_ETAG')`).
 * Returns every part's ETag in part order, for `POST …/complete`.
 */
export async function uploadS3Multipart(input: MultipartInput): Promise<CompletedPart[]> {
  const {
    file,
    ticket,
    state,
    signal,
    onProgress,
    fetchState,
    concurrency = 3,
    fetch: put = (url, init) => fetch(url, init),
    sleep = wait,
    now = Date.now,
    storage,
  } = input;
  const { mediaId, partSizeBytes, partCount } = ticket;
  const partSize = (n: number) => Math.min(n * partSizeBytes, file.size) - (n - 1) * partSizeBytes;

  const etags = new Map<number, string>();
  for (const p of state?.uploaded ?? []) etags.set(p.partNumber, p.etag);
  let urls = new Map((state?.parts ?? ticket.parts).map((p) => [p.partNumber, p.url]));
  let urlsAt = now();
  let refreshing: Promise<void> | null = null;

  const refresh = (): Promise<void> => {
    refreshing ??= fetchState()
      .then((fresh) => {
        urls = new Map(fresh.parts.map((p) => [p.partNumber, p.url]));
        urlsAt = now();
        for (const p of fresh.uploaded)
          if (!etags.has(p.partNumber)) etags.set(p.partNumber, p.etag);
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  };

  const urlFor = async (n: number, force: boolean): Promise<string | undefined> => {
    if (force || !urls.has(n) || now() - urlsAt > URL_MAX_AGE_MS) await refresh();
    return urls.get(n);
  };

  let sent = 0;
  for (const n of etags.keys()) sent += partSize(n);
  const report = () => onProgress?.(Math.min(sent, file.size), file.size);

  const sendPart = async (n: number): Promise<void> => {
    let forceRefresh = false;
    for (let attempt = 0; ; attempt += 1) {
      if (signal?.aborted) throw abortError();
      if (etags.has(n)) return; // stored meanwhile (seen in a refreshed state)
      const url = await urlFor(n, forceRefresh);
      forceRefresh = false;
      let failure: unknown;
      if (url) {
        try {
          const blob = file.slice((n - 1) * partSizeBytes, Math.min(n * partSizeBytes, file.size));
          const res = await put(url, { method: 'PUT', body: blob, signal });
          if (res.ok) {
            const etag = res.headers.get('ETag');
            if (!etag) {
              throw new MultipartError(
                'CORS_ETAG',
                'CORS: ETag not exposed — the bucket CORS rule must list ETag in ExposeHeaders (runbook courses-and-media)',
              );
            }
            etags.set(n, etag);
            markPartDone(mediaId, n, storage);
            sent += partSize(n);
            report();
            return;
          }
          // An expired or rejected signature: sign again before the retry.
          if (res.status === 403) forceRefresh = true;
          failure = new MultipartError('PART_FAILED', `Part ${n} answered ${res.status}`);
        } catch (error) {
          if (error instanceof MultipartError && error.code === 'CORS_ETAG') throw error;
          if (signal?.aborted || (error as { name?: string })?.name === 'AbortError') {
            throw abortError();
          }
          failure = error;
        }
      } else {
        forceRefresh = true;
        failure = new MultipartError('PART_FAILED', `No upload URL for part ${n}`);
      }
      if (attempt >= RETRIES) {
        throw failure instanceof MultipartError
          ? failure
          : new MultipartError('PART_FAILED', `Part ${n} failed: ${String(failure)}`);
      }
      await sleep(BACKOFF_MS * 2 ** attempt);
    }
  };

  if (signal?.aborted) throw abortError();
  const queue: number[] = [];
  for (let n = 1; n <= partCount; n += 1) if (!etags.has(n)) queue.push(n);
  report();

  let failed = false;
  const worker = async () => {
    while (!failed && queue.length > 0) {
      const n = queue.shift()!;
      try {
        await sendPart(n);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker),
  );

  return [...etags.entries()]
    .filter(([n]) => n >= 1 && n <= partCount)
    .sort(([a], [b]) => a - b)
    .map(([partNumber, etag]) => ({ partNumber, etag }));
}
