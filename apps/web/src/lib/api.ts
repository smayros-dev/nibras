import createClient from 'openapi-fetch';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

/**
 * openapi-fetch client. Task 5 moves `createApiClient` into `@tt/contracts`, typed with the generated
 * OpenAPI `paths`; replace this local definition with that import once it lands.
 */
function createApiClient(baseUrl: string, fetchImpl?: typeof fetch) {
  return createClient({ baseUrl, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

/** Client components: same-origin `/api/v1` (rewritten to the API by `next.config.ts`). */
export const api = createApiClient('/api/v1');

/** Server components: call the API directly, forwarding the incoming request's `cookie` header. */
export async function serverApi() {
  // Imported lazily so this module stays importable from client components.
  const { headers } = await import('next/headers');
  const cookie = (await headers()).get('cookie');
  return createApiClient(`${API_URL}/api/v1`, (input, init) => {
    const request = new Request(input, init);
    if (cookie) request.headers.set('cookie', cookie);
    return fetch(request);
  });
}
