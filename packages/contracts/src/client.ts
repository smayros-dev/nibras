import createClient, { type Client } from 'openapi-fetch';
import type { paths } from './generated/api';

export type { components, operations, paths } from './generated/api';

/** Typed client for the API, generated from `openapi/openapi.json`. */
export type ApiClient = Client<paths>;

/**
 * `baseUrl` includes the `/api/v1` prefix (e.g. `/api/v1` in the browser, `${API_URL}/api/v1` on
 * the server). `fetchImpl` lets callers decorate requests (e.g. forward cookies).
 */
export function createApiClient(baseUrl: string, fetchImpl?: typeof fetch): ApiClient {
  return createClient<paths>({ baseUrl, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}
