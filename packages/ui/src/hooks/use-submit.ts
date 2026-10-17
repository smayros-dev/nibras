'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Wraps an async action with a `busy` flag that always resets (`try/finally`, audit #5).
 * Rejections propagate to the caller after the reset — nothing is swallowed. `submit` is stable
 * and always calls the latest `fn`.
 */
export function useSubmit<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
): { submit: (...args: Args) => Promise<T>; busy: boolean } {
  const [busy, setBusy] = useState(false);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const submit = useCallback(async (...args: Args) => {
    setBusy(true);
    try {
      return await fnRef.current(...args);
    } finally {
      setBusy(false);
    }
  }, []);
  return { submit, busy };
}
