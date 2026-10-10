import createClient, { type Client } from 'openapi-fetch';
import type { paths } from './generated/api';

export type { components, operations, paths } from './generated/api';

/** Typed client for the API, generated from `openapi/openapi.json`. */
export type ApiClient = Client<paths>;

/**
 * `baseUrl` is the API base including the `/api/v1` prefix (the document's server): `/api/v1` in
 * the browser, `${API_URL}/api/v1` on the server. Paths are appended to it, so the health probes
 * (served outside the prefix) are not meant to be called through this client. `fetchImpl` lets
 * callers decorate requests (e.g. forward cookies).
 */
export function createApiClient(baseUrl: string, fetchImpl?: typeof fetch): ApiClient {
  return createClient<paths>({ baseUrl, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}
