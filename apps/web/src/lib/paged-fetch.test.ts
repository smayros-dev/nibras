// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
