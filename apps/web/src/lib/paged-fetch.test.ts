// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './fetch-timeout';
import { useAbortableQuery } from './paged-fetch';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAbortableQuery', () => {
  it('runs immediately on mount, then debounces key changes', async () => {
    const run = vi.fn(async () => 'x');
    const { rerender } = renderHook(({ q }) => useAbortableQuery([q], run, { debounceMs: 300 }), {
      initialProps: { q: '' },
    });
    expect(run).toHaveBeenCalledTimes(1);
    rerender({ q: 'a' });
    rerender({ q: 'ab' });
    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reports whether data matches the current key (false during the debounce)', async () => {
    const run = vi.fn(async () => 'x');
    const { result, rerender } = renderHook(
      ({ q }) => useAbortableQuery([q], run, { debounceMs: 300 }),
      { initialProps: { q: '' } },
    );
    await act(async () => {});
    expect(result.current.current).toBe(true);
    rerender({ q: 'a' });
    expect(result.current.current).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.current).toBe(true);
  });

  it('aborts the previous run when the key changes', async () => {
    const signals: AbortSignal[] = [];
    const run = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<string>(() => {});
    });
    const { rerender } = renderHook(({ q }) => useAbortableQuery([q], run, { debounceMs: 300 }), {
      initialProps: { q: '' },
    });
    rerender({ q: 'a' });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('swallows the AbortError of an aborted run: error stays null', async () => {
    const pending: Deferred<string>[] = [];
    const run = vi.fn((signal: AbortSignal) => {
      const d = deferred<string>();
      // What `fetch` does: an aborted request rejects with a DOMException named AbortError.
      signal.addEventListener('abort', () =>
        d.reject(new DOMException('The operation was aborted.', 'AbortError')),
      );
      pending.push(d);
      return d.promise;
    });
    const { result, rerender } = renderHook(
      ({ q }) => useAbortableQuery([q], run, { debounceMs: 300 }),
      { initialProps: { q: '' } },
    );
    rerender({ q: 'a' });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(run).toHaveBeenCalledTimes(2);
    const aborted = run.mock.calls[0]?.[0];
    expect(aborted?.aborted).toBe(true);
    await expect(pending[0]?.promise).rejects.toMatchObject({ name: 'AbortError' });
    await act(async () => {});
    expect(result.current.error).toBeNull();
    // The newer run is still in flight.
    expect(result.current.loading).toBe(true);
    await act(async () => {
      pending[1]?.resolve('ok');
    });
    expect(result.current).toMatchObject({ data: 'ok', error: null, loading: false });
  });

  it('ignores a stale result that resolves after a newer one (sequence guard)', async () => {
    const calls: Deferred<string>[] = [];
    // A run that ignores its signal: only the sequence guard can drop the stale value.
    const run = vi.fn(() => {
      const d = deferred<string>();
      calls.push(d);
      return d.promise;
    });
    const { result, rerender } = renderHook(
      ({ q }) => useAbortableQuery([q], run, { debounceMs: 300 }),
      { initialProps: { q: 'a' } },
    );
    rerender({ q: 'ab' });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(calls).toHaveLength(2);
    await act(async () => {
      calls[1]?.resolve('ab');
    });
    expect(result.current.data).toBe('ab');
    await act(async () => {
      calls[0]?.resolve('a');
    });
    expect(result.current.data).toBe('ab');
    expect(result.current.loading).toBe(false);
  });

  describe('with the API client timeout (withTimeout)', () => {
    /** A run shaped like the call sites: a thrown fetch error becomes the generic message. */
    function timedRun(timeoutMs: number) {
      const base = (_: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        });
      return vi.fn(async (signal: AbortSignal) => {
        try {
          await withTimeout(base as typeof fetch, timeoutMs)('/api/v1/x', { signal });
          return 'ok';
        } catch {
          throw new Error('errors.INTERNAL_ERROR');
        }
      });
    }

    it('reports a timeout as an error (not a silent abort)', async () => {
      vi.useRealTimers();
      const run = timedRun(20);
      const { result } = renderHook(() => useAbortableQuery(['k'], run));
      await vi.waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe('errors.INTERNAL_ERROR');
      expect(run.mock.calls[0]?.[0].aborted).toBe(false);
    });

    it('still treats a user abort (key change) as silent', async () => {
      const run = timedRun(60_000);
      const { result, rerender } = renderHook(
        ({ q }) => useAbortableQuery([q], run, { debounceMs: 300 }),
        { initialProps: { q: '' } },
      );
      rerender({ q: 'a' });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(run.mock.calls[0]?.[0].aborted).toBe(true);
      await act(async () => {});
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(true);
    });
  });

  it('reports the error of the latest run and reloads on demand without debounce', async () => {
    const run = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');
    const { result } = renderHook(() => useAbortableQuery(['k'], run));
    await act(async () => {});
    expect(result.current.error).toBe('boom');
    await act(async () => {
      result.current.reload();
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe('ok');
    expect(result.current.error).toBeNull();
  });
});
