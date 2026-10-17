import { createApiClient } from '@tt/contracts/web';
import type { ApiErrorBody } from '@tt/contracts';
import { createRefreshingFetch } from './auth-refresh';
import { API_TIMEOUT_MS, withTimeout } from './fetch-timeout';
import { forwardHeaders } from './forwarded-headers';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

/**
 * The client components' fetch: every send (the first one, the `/auth/refresh` and the retry
 * after it) gets its own {@link API_TIMEOUT_MS} timeout, combined with the caller's signal
 * (`withTimeout`); a session-expiry 401 is answered by one shared refresh and one retry
 * (`auth-refresh.ts`). `base` is resolved per call so tests and the browser's own `fetch` stubs
 * are honoured.
 */
export function browserFetch(
  base: typeof fetch = (input, init) => fetch(input, init),
  timeoutMs: number = API_TIMEOUT_MS,
): typeof fetch {
  return createRefreshingFetch(withTimeout(base, timeoutMs));
}

/** Client components: same-origin `/api/v1` (rewritten to the API by `next.config.ts`). */
export const api = createApiClient('/api/v1', browserFetch());

/**
 * Server components: call the API directly, forwarding the incoming request's `cookie`,
 * `x-forwarded-for`, `x-request-id` and `accept-language` headers. Same timeout as the browser.
 */
export async function serverApi() {
  // Imported lazily so this module stays importable from client components.
  const { headers } = await import('next/headers');
  const incoming = await headers();
  return createApiClient(
    `${API_URL}/api/v1`,
    withTimeout((input, init) => {
      const request = new Request(input, init);
      forwardHeaders(incoming, request.headers);
      return fetch(request);
    }),
  );
}

/**
 * The generated OpenAPI document has no response schemas (`content?: never` — the Nest swagger
 * plugin cannot infer zod DTO return types), so `openapi-fetch` types both `data` and `error`
 * as `never`. The runtime shapes are the contracts' types; every call site casts through this.
 */
export interface ApiResult<T> {
  data?: T;
  error?: ApiErrorBody;
}

export function asApiResult<T>(result: { data?: never; error?: never }): ApiResult<T> {
  return result as unknown as ApiResult<T>;
}
