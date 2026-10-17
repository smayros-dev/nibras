/** Upper bound for one API call; a hung connection otherwise leaves the UI loading forever. */
export const API_TIMEOUT_MS = 30_000;

/**
 * `AbortSignal.timeout(ms)`, or an equivalent when the runtime lacks it: aborts with a
 * `TimeoutError` `DOMException`, so a timeout stays distinguishable from a caller's abort
 * (`AbortError`).
 */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('signal timed out', 'TimeoutError')), ms);
  return controller.signal;
}

/**
 * `AbortSignal.any(signals)`: aborts as soon as one input does, with that input's reason. Falls
 * back to abort listeners where `AbortSignal.any` is missing (older Safari).
 */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
  }
  const forward = (event: Event) => {
    controller.abort((event.target as AbortSignal).reason);
    for (const signal of signals) signal.removeEventListener('abort', forward);
  };
  for (const signal of signals) signal.addEventListener('abort', forward, { once: true });
  return controller.signal;
}

/**
 * `fetch` that gives every call a fresh `ms` timeout, combined with the caller's signal (from
 * `init`, else from a `Request` input — openapi-fetch puts it there). A timeout rejects like a
 * network failure (`TimeoutError`), so call sites' existing `catch` maps it to
 * `errors.INTERNAL_ERROR`; a caller's abort still rejects with its own `AbortError`.
 */
export function withTimeout(base: typeof fetch, ms: number = API_TIMEOUT_MS): typeof fetch {
  return (input, init) => {
    const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const timeout = timeoutSignal(ms);
    const signal = caller ? anySignal([caller, timeout]) : timeout;
    return base(input, { ...init, signal });
  };
}
