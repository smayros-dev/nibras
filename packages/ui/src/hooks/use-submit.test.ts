import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
