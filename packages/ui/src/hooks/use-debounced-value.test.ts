import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './use-debounced-value';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes the last value 300 ms after the changes stop', () => {
    const { result, rerender } = renderHook(({ v }: { v: string }) => useDebouncedValue(v), {
      initialProps: { v: '' },
    });
    rerender({ v: 'a' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ v: 'ab' });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('ab');
  });

  it('honours a custom delay', () => {
    const { result, rerender } = renderHook(({ v }: { v: number }) => useDebouncedValue(v, 50), {
      initialProps: { v: 1 },
    });
    rerender({ v: 2 });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toBe(2);
  });
});
