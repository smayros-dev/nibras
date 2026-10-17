'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Wraps an async action with a `busy` flag that always resets (`try/finally`, audit #5).
 * Rejections propagate to the caller after the reset — nothing is swallowed. `submit` is stable
 * and always calls the latest `fn`. Calls made while one is in flight return that same promise.
 */
export function useSubmit<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
): { submit: (...args: Args) => Promise<T>; busy: boolean } {
  const [busy, setBusy] = useState(false);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  // Re-entrancy guard (double click, Enter + click): a call made while one is running does not
  // start the action again; it gets the in-flight promise.
  const inFlight = useRef<Promise<T> | null>(null);
  const submit = useCallback((...args: Args): Promise<T> => {
    if (inFlight.current) return inFlight.current;
    setBusy(true);
    let started: Promise<T>;
    try {
      started = Promise.resolve(fnRef.current(...args));
    } catch (error) {
      started = Promise.reject(error);
    }
    // `.finally` always settles asynchronously, so the guard is set before it is cleared.
    const run = started.finally(() => {
      inFlight.current = null;
      setBusy(false);
    });
    inFlight.current = run;
    return run;
  }, []);
  return { submit, busy };
}
