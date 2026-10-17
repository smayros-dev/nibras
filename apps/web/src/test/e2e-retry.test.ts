import type { APIResponse } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { MAX_RETRY_AFTER_MS, retryAfterMs } from '../../e2e/helpers/retry';

/** The e2e `429` helper (`e2e/helpers/retry.ts`); it lives outside `src/`, so it is tested here. */
function withRetryAfter(value: string | undefined): APIResponse {
  return {
    headers: () => (value === undefined ? {} : { 'retry-after': value }),
  } as unknown as APIResponse;
}

describe('e2e retryAfterMs', () => {
  it('waits what Retry-After asks for (delta seconds), else 1 s', () => {
    expect(retryAfterMs(withRetryAfter('2'))).toBe(2000);
    expect(retryAfterMs(withRetryAfter('0'))).toBe(100);
    expect(retryAfterMs(withRetryAfter(undefined))).toBe(1000);
    expect(retryAfterMs(withRetryAfter('soon'))).toBe(1000);
  });

  it('caps the wait at about 10 s, so a long window cannot stall a test until its timeout', () => {
    expect(MAX_RETRY_AFTER_MS).toBe(10_000);
    expect(retryAfterMs(withRetryAfter('10'))).toBe(10_000);
    expect(retryAfterMs(withRetryAfter('60'))).toBe(10_000);
    expect(retryAfterMs(withRetryAfter('86400'))).toBe(10_000);
  });
});
