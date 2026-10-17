import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSubmit } from './use-submit';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useSubmit', () => {
  it('is busy while the action runs and returns its result', async () => {
    const d = deferred<number>();
    const { result } = renderHook(() => useSubmit((n: number) => d.promise.then((v) => v + n)));
    expect(result.current.busy).toBe(false);
    let pending!: Promise<number>;
    act(() => {
      pending = result.current.submit(1);
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      d.resolve(41);
      await expect(pending).resolves.toBe(42);
    });
    expect(result.current.busy).toBe(false);
  });

  it('resets busy even when the action throws', async () => {
    const { result } = renderHook(() =>
      useSubmit(async () => {
        throw new Error('boom');
      }),
    );
    await act(async () => {
      await expect(result.current.submit()).rejects.toThrow('boom');
    });
    expect(result.current.busy).toBe(false);
  });

  it('calls the latest action without changing submit identity', async () => {
    const calls: string[] = [];
    const { result, rerender } = renderHook(
      ({ tag }: { tag: string }) =>
        useSubmit(async () => {
          calls.push(tag);
        }),
      { initialProps: { tag: 'a' } },
    );
    const first = result.current.submit;
    rerender({ tag: 'b' });
    expect(result.current.submit).toBe(first);
    await act(() => result.current.submit());
    expect(calls).toEqual(['b']);
  });

  it('ignores re-entrant calls while one is in flight, then accepts a new one', async () => {
    const d = deferred<string>();
    const fn = vi.fn(() => d.promise);
    const { result } = renderHook(() => useSubmit(fn));
    let first!: Promise<string>;
    let second!: Promise<string>;
    act(() => {
      first = result.current.submit();
      second = result.current.submit();
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    await act(async () => {
      d.resolve('ok');
      await expect(second).resolves.toBe('ok');
    });
    expect(result.current.busy).toBe(false);
    fn.mockImplementation(() => Promise.resolve('again'));
    await act(async () => {
      await expect(result.current.submit()).resolves.toBe('again');
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('releases the guard when the action throws synchronously', async () => {
    let calls = 0;
    const { result } = renderHook(() =>
      useSubmit((): Promise<void> => {
        calls += 1;
        throw new Error('sync');
      }),
    );
    await act(async () => {
      await expect(result.current.submit()).rejects.toThrow('sync');
    });
    await act(async () => {
      await expect(result.current.submit()).rejects.toThrow('sync');
    });
    expect(calls).toBe(2);
    expect(result.current.busy).toBe(false);
  });
});
