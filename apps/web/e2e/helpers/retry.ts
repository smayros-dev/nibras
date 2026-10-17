import type { APIResponse } from '@playwright/test';

/** Resolve after `ms` — only for backoff between attempts, never as a wait for UI state. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Delay in ms for a `429`: its `Retry-After` (delta seconds), else 1 s. */
export function retryAfterMs(response: APIResponse): number {
  const seconds = Number(response.headers()['retry-after']);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.max(seconds, 0.1) * 1000 : 1000;
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
