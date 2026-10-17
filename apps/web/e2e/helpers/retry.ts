import type { APIResponse } from '@playwright/test';

/** Resolve after `ms` — only for backoff between attempts, never as a wait for UI state. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Longest single wait: a long throttle window must fail the test, not stall it until timeout. */
export const MAX_RETRY_AFTER_MS = 10_000;

/** Delay in ms for a `429`: its `Retry-After` (delta seconds, capped at 10 s), else 1 s. */
export function retryAfterMs(response: APIResponse): number {
  const seconds = Number(response.headers()['retry-after']);
  if (!Number.isFinite(seconds) || seconds < 0) return 1000;
  return Math.min(Math.max(seconds, 0.1) * 1000, MAX_RETRY_AFTER_MS);
}

/**
 * Call `fn` until it answers something other than `429 RATE_LIMITED` (at most `attempts` calls),
 * waiting what the API asks for (`Retry-After`, set by its exception filter) between calls —
 * never a guessed fixed sleep. The last response is returned (a `429` if every attempt was
 * throttled), so callers keep their own status assertions.
 */
export async function retryOn429(
  fn: () => Promise<APIResponse>,
  { attempts = 5 }: { attempts?: number } = {},
): Promise<APIResponse> {
  let response = await fn();
  for (let attempt = 1; attempt < attempts && response.status() === 429; attempt++) {
    await sleep(retryAfterMs(response));
    response = await fn();
  }
  return response;
}
