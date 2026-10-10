import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';

describe('createApiClient', () => {
  // The document has no prefixed routes yet: this only checks that typed paths are appended to
  // `baseUrl` (the API base, `/api/v1` included) and sent through `fetchImpl`.
  it('calls typed paths relative to the base url through the given fetch', async () => {
    const fetchImpl = vi.fn(
      async (_input: Request) =>
        new Response(JSON.stringify({ status: 'ok' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const client = createApiClient('http://api.test/api/v1', fetchImpl as unknown as typeof fetch);
    const { data, response } = await client.GET('/health/live');
    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'ok' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0].url).toBe('http://api.test/api/v1/health/live');
  });
});
