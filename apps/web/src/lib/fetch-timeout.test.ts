import { createApiClient } from '@tt/contracts/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserFetch } from './api';
import { API_TIMEOUT_MS, anySignal, withTimeout } from './fetch-timeout';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The signal `fetch` would honour: `init.signal` wins over the `Request`'s own. */
function effectiveSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | undefined {
  return init?.signal ?? (input instanceof Request ? input.signal : undefined);
}

/** A `fetch` that never answers and rejects with the abort reason, like the real one. */
function hangingFetch(seen: AbortSignal[] = []) {
  return vi.fn(
    (input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        const signal = effectiveSignal(input, init);
        if (!signal) return;
        seen.push(signal);
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
}

describe('withTimeout', () => {
  it('defaults to about 30 s', () => {
    expect(API_TIMEOUT_MS).toBe(30_000);
  });

  it('aborts a request that outlives the timeout with a TimeoutError', async () => {
    const f = withTimeout(hangingFetch() as typeof fetch, 20);
    await expect(f('/api/v1/me')).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it("keeps the caller's signal: a caller abort rejects with an AbortError, before the timeout", async () => {
    const controller = new AbortController();
    const f = withTimeout(hangingFetch() as typeof fetch, 10_000);
    const pending = f('/api/v1/me', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it("honours the signal carried by a Request input (openapi-fetch's shape)", async () => {
    const controller = new AbortController();
    const f = withTimeout(hangingFetch() as typeof fetch, 10_000);
    const pending = f(new Request('http://localhost/api/v1/me', { signal: controller.signal }));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('passes the response through untouched when the API answers in time', async () => {
    const base = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response('{"ok":true}', { status: 200 }),
    );
    const res = await withTimeout(base as typeof fetch, 1_000)('/api/v1/me', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(base.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });
  });
});

describe('anySignal', () => {
  it('uses AbortSignal.any when available', () => {
    const a = new AbortController();
    const combined = anySignal([a.signal, new AbortController().signal]);
    a.abort(new Error('a'));
    expect(combined.aborted).toBe(true);
    expect((combined.reason as Error).message).toBe('a');
  });

  it('falls back to listeners when AbortSignal.any is missing, keeping the first reason', () => {
    vi.stubGlobal(
      'AbortSignal',
      Object.assign(Object.create(AbortSignal), { any: undefined, timeout: AbortSignal.timeout }),
    );
    const a = new AbortController();
    const b = new AbortController();
    const combined = anySignal([a.signal, b.signal]);
    expect(combined.aborted).toBe(false);
    b.abort(new Error('b'));
    a.abort(new Error('a'));
    expect(combined.aborted).toBe(true);
    expect((combined.reason as Error).message).toBe('b');
  });

  it('fallback: an already-aborted input aborts the result immediately', () => {
    vi.stubGlobal('AbortSignal', Object.assign(Object.create(AbortSignal), { any: undefined }));
    const a = new AbortController();
    a.abort(new Error('early'));
    const combined = anySignal([new AbortController().signal, a.signal]);
    expect(combined.aborted).toBe(true);
    expect((combined.reason as Error).message).toBe('early');
  });

  it('withTimeout still times out without AbortSignal.any or AbortSignal.timeout', async () => {
    vi.stubGlobal(
      'AbortSignal',
      Object.assign(Object.create(AbortSignal), { any: undefined, timeout: undefined }),
    );
    const f = withTimeout(hangingFetch() as typeof fetch, 20);
    await expect(f('/api/v1/me')).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

describe('browserFetch (the client components’ fetch)', () => {
  it('a retry after a session refresh keeps both the caller signal and a fresh timeout', async () => {
    const seen: AbortSignal[] = [];
    let first = true;
    const base = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(new Response('{}'));
      if (first) {
        first = false;
        seen.push(effectiveSignal(input, init)!);
        return Promise.resolve(
          new Response('{"code":"UNAUTHENTICATED"}', {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return hangingFetch(seen)(input, init);
    });
    const controller = new AbortController();
    const pending = browserFetch(
      base as typeof fetch,
      10_000,
    )(new Request('http://localhost/api/v1/me', { signal: controller.signal }));
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    // The retry is wired to the caller: aborting it aborts the retried request.
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen[1]?.aborted).toBe(true);
  });

  it('the retry after a refresh times out on its own (TimeoutError)', async () => {
    let first = true;
    const base = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(new Response('{}'));
      if (first) {
        first = false;
        return Promise.resolve(new Response('{"code":"UNAUTHENTICATED"}', { status: 401 }));
      }
      return hangingFetch()(input, init);
    });
    await expect(
      browserFetch(base as typeof fetch, 20)(new Request('http://localhost/api/v1/me')),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('through openapi-fetch, a timeout is a thrown error (call sites map it to INTERNAL_ERROR)', async () => {
    const client = createApiClient(
      'http://localhost/api/v1',
      browserFetch(hangingFetch() as typeof fetch, 20),
    );
    await expect(client.GET('/me')).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
