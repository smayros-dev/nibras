import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRefreshingFetch,
  lastRefreshAt,
  refreshSession,
  SESSION_EXPIRED_EVENT,
} from './auth-refresh';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createRefreshingFetch', () => {
  it('ten concurrent 401s trigger one refresh and retry each call once with its body', async () => {
    const calls: string[] = [];
    let refreshes = 0;
    const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        refreshes++;
        await delay(10);
        return new Response('{"ok":true}', { status: 200 });
      }
      calls.push(`${url}:${typeof init?.body === 'string' ? init.body : ''}`);
      const seen = calls.filter((c) => c.startsWith(`${url}:`)).length;
      return new Response(null, { status: seen === 1 ? 401 : 200 });
    });
    const f = createRefreshingFetch(base as typeof fetch);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        f(`/api/v1/me/${i}`, { method: 'POST', body: JSON.stringify({ i }) }),
      ),
    );
    expect(refreshes).toBe(1);
    expect(results.every((r) => r.status === 200)).toBe(true);
    const third = calls.filter((c) => c.startsWith('/api/v1/me/3:'));
    expect(third).toHaveLength(2);
    expect(third.every((c) => c.includes('{"i":3}'))).toBe(true);
  });

  it('retries a Request object (as openapi-fetch sends it) with its original body', async () => {
    const bodies: string[] = [];
    let n = 0;
    const base = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input instanceof Request ? input.url : input).endsWith('/auth/refresh')) {
        return new Response('{"ok":true}', { status: 200 });
      }
      bodies.push(await (input as Request).text());
      return new Response(null, { status: n++ === 0 ? 401 : 200 });
    });
    const f = createRefreshingFetch(base as typeof fetch);
    const res = await f(
      new Request('http://localhost/api/v1/me', { method: 'PATCH', body: '{"firstName":"A"}' }),
    );
    expect(res.status).toBe(200);
    expect(bodies).toEqual(['{"firstName":"A"}', '{"firstName":"A"}']);
  });

  it.each([
    '/api/v1/auth/refresh',
    '/api/v1/auth/login',
    '/api/v1/auth/logout',
    '/api/v1/auth/2fa/verify',
    '/api/v1/auth/2fa/recovery',
  ])('never refreshes or retries %s', async (path) => {
    const base = vi.fn(async () => new Response(null, { status: 401 }));
    const f = createRefreshingFetch(base as typeof fetch);
    const res = await f(path, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on a 401 that is not about the session (wrong password, wrong code)', async () => {
    const base = vi.fn(
      async () =>
        new Response('{"code":"INVALID_CREDENTIALS","message":"x"}', {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const f = createRefreshingFetch(base as typeof fetch);
    const res = await f('/api/v1/auth/password', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('dispatches tt:session-expired when the refresh fails and returns the 401', async () => {
    const target = new EventTarget();
    const listener = vi.fn();
    target.addEventListener(SESSION_EXPIRED_EVENT, listener);
    vi.stubGlobal('window', target);
    const base = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/auth/refresh')
        ? new Response('{"code":"SESSION_REVOKED"}', { status: 401 })
        : new Response('{"code":"UNAUTHENTICATED"}', { status: 401 }),
    );
    const f = createRefreshingFetch(base as typeof fetch);
    const res = await f('/api/v1/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'UNAUTHENTICATED' });
    expect(base).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('passes non-401 responses through untouched', async () => {
    const base = vi.fn(async () => new Response('x', { status: 403 }));
    const res = await createRefreshingFetch(base as typeof fetch)('/api/v1/me');
    expect(res.status).toBe(403);
    expect(base).toHaveBeenCalledTimes(1);
  });
});

describe('refreshSession', () => {
  it('is single-flight and resolves to whether the refresh succeeded', async () => {
    const base = vi.fn(async () => {
      await delay(5);
      return new Response('{"ok":true}', { status: 200 });
    });
    const [a, b] = await Promise.all([
      refreshSession(base as typeof fetch),
      refreshSession(base as typeof fetch),
    ]);
    expect([a, b]).toEqual([true, true]);
    expect(base).toHaveBeenCalledTimes(1);
    expect(base).toHaveBeenCalledWith(
      '/api/v1/auth/refresh',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
    // A later call (after the first settled) refreshes again.
    await refreshSession(base as typeof fetch);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('resolves false on a network error', async () => {
    const base = vi.fn(async () => {
      throw new TypeError('network');
    });
    await expect(refreshSession(base as typeof fetch)).resolves.toBe(false);
  });

  it('does not rotate again when another tab refreshed while this one waited for the lock', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
    const base = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    let release!: () => void;
    // "Tab A" holds the lock, rotates, then records the time it finished.
    const tabA = navigator.locks.request(
      'tt-auth-refresh',
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            store.set('tt.auth.refreshedAt', String(Date.now() + 1));
            resolve();
          };
        }),
    );
    await delay(1);
    const tabB = refreshSession(base as typeof fetch);
    await delay(5);
    release();
    await tabA;
    await expect(tabB).resolves.toBe(true);
    expect(base).not.toHaveBeenCalled();
    expect(lastRefreshAt()).toBeGreaterThan(0);
  });

  it('records a successful refresh for the other tabs', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
    const base = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    await refreshSession(base as typeof fetch);
    expect(base).toHaveBeenCalledTimes(1);
    expect(Number(store.get('tt.auth.refreshedAt'))).toBeGreaterThan(0);
  });
});
