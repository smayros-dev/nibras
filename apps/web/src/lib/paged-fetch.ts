'use client';

import { useDebouncedValue } from '@tt/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface AbortableQuery<T> {
  /** The latest successful result (kept while a newer request runs, so lists do not flash). */
  data: T | undefined;
  /** `Error.message` of the latest failed run (callers throw translated messages). */
  error: string | null;
  loading: boolean;
  /**
   * `data` was produced for the current `key` (false during the debounce after a key change and
   * while the new run is pending). Gate key-dependent actions on it, e.g. a pagination cursor
   * taken from `data` must not be sent with filters from another result set.
   */
  current: boolean;
  /** Runs again now with the current key (after a mutation), bypassing the debounce. */
  reload(): void;
}

/**
 * Filtered list loading (audit #9, Review Focus 4): the first run starts on mount, later `key`
 * changes are debounced by `debounceMs`; each run aborts the previous one (`AbortController`,
 * openapi-fetch takes `signal`) and a result is applied only if its sequence number is still the
 * latest, so a slow, non-abortable response for `a` can never overwrite the one for `ab`.
 * `run` is read from the latest render, so it may close over the current filters.
 */
export function useAbortableQuery<T>(
  key: unknown[],
  run: (signal: AbortSignal) => Promise<T>,
  { debounceMs = 300 }: { debounceMs?: number } = {},
): AbortableQuery<T> {
  const serialized = JSON.stringify(key);
  const debouncedKey = useDebouncedValue(serialized, debounceMs);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  const sequence = useRef(0);
  const [reloads, setReloads] = useState(0);
  const [state, setState] = useState<{
    data: T | undefined;
    /** Serialized key `data` was produced for. */
    dataKey: string | undefined;
    error: string | null;
  }>({ data: undefined, dataKey: undefined, error: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = ++sequence.current;
    const controller = new AbortController();
    setLoading(true);
    runRef.current(controller.signal).then(
      (data) => {
        if (id !== sequence.current) return;
        setState({ data, dataKey: debouncedKey, error: null });
        setLoading(false);
      },
      (error: unknown) => {
        if (id !== sequence.current || controller.signal.aborted) return;
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : String(error),
        }));
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [debouncedKey, reloads]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);
  return {
    data: state.data,
    error: state.error,
    loading,
    current: state.data !== undefined && state.dataKey === serialized,
    reload,
  };
}
