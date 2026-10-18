import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SW_VERSION } from './sw-version';

/**
 * `public/sw.js` (plain JS, no bundler) run in a VM with a fake service-worker global: Cache
 * Storage, `fetch`, `clients` and the event plumbing. Asserts the cache policy (spec D6, Review
 * Focus 5): only `/_next/static/` and the anonymous offline pages are ever stored; API calls,
 * HTML navigations and non-GET requests are never cached.
 */
const SOURCE = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8');
const ORIGIN = 'https://nibras.test';

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
  request?: { url: string; method: string; mode: string };
  data?: unknown;
  respondWith: (response: Promise<Response> | Response) => void;
  waitUntil: (promise: Promise<unknown>) => void;
  responded?: Promise<Response> | Response;
  waits: Promise<unknown>[];
}

/**
 * Like Cache Storage, `keys()` lists entries in insertion order and a `put`/`add` over an
 * existing key removes the old entry and appends the new one (so it moves to the end).
 */
class FakeCache {
  readonly entries = new Map<string, Response>();
  constructor(private readonly fetcher: (input: unknown) => Promise<Response>) {}
  private key(input: unknown): string {
    const url = typeof input === 'string' ? input : (input as { url: string }).url;
    return new URL(url, ORIGIN).href;
  }
  async match(input: unknown) {
    return this.entries.get(this.key(input))?.clone();
  }
  private store(input: unknown, response: Response) {
    const key = this.key(input);
    this.entries.delete(key);
    this.entries.set(key, response);
  }
  async put(input: unknown, response: Response) {
    this.store(input, response);
  }
  async add(input: unknown) {
    const response = await this.fetcher(input);
    if (!response.ok) throw new TypeError('bad response');
    this.store(input, response);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(input: unknown) {
    return this.entries.delete(this.key(input));
  }
}

function basic(body: BodyInit | null, init: ResponseInit & { redirected?: boolean } = {}) {
  const response = new Response(body, init);
  Object.defineProperty(response, 'type', { value: 'basic' });
  if (init.redirected) Object.defineProperty(response, 'redirected', { value: true });
  return response;
}

const OFFLINE_HTML = (locale: string) =>
  `<!doctype html><html lang="${locale}"><head><link rel="stylesheet" href="/_next/static/css/app.css"/>` +
  `<script src="/_next/static/chunks/main.js" async=""></script></head><body><h1>offline ${locale}</h1></body></html>`;

function setup({
  active = false,
  network = (url: URL): Response => {
    if (/^\/(fr|ar|en)\/offline$/.test(url.pathname))
      return basic(OFFLINE_HTML(url.pathname.slice(1, 3)), {
        headers: { 'content-type': 'text/html' },
      });
    return basic(`body of ${url.pathname}`);
  },
  existingCaches = [] as string[],
} = {}) {
  const listeners = new Map<string, Listener[]>();
  const stores = new Map<string, FakeCache>();
  const fetchMock = vi.fn(async (input: unknown, _init?: unknown) => {
    const raw = typeof input === 'string' ? input : (input as { url: string }).url;
    return network(new URL(raw, ORIGIN));
  });
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new FakeCache(fetchMock));
      return stores.get(name)!;
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
    async match(input: unknown, options?: { cacheName?: string }) {
      const names = options?.cacheName ? [options.cacheName] : [...stores.keys()];
      for (const name of names) {
        const hit = await stores.get(name)?.match(input);
        if (hit) return hit;
      }
      return undefined;
    },
  };
  for (const name of existingCaches) void caches.open(name);
  const self = {
    location: new URL(`/sw.js?v=${SW_VERSION}`, ORIGIN),
    registration: { active: active ? {} : null },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };
  vm.runInNewContext(SOURCE, {
    self,
    caches,
    fetch: fetchMock,
    URL,
    Request,
    Response,
    Headers,
    Promise,
    Set,
    TypeError,
    console,
  });

  function dispatch(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    const event: FakeEvent = {
      ...init,
      waits: [],
      respondWith(response) {
        event.responded = response;
      },
      waitUntil(promise) {
        event.waits.push(promise);
      },
    };
    for (const listener of listeners.get(type) ?? []) listener(event);
    return event;
  }

  async function settle(event: FakeEvent) {
    await Promise.all(event.waits);
    return event;
  }

  function request(path: string, { method = 'GET', mode = 'cors' } = {}) {
    return { url: new URL(path, ORIGIN).href, method, mode };
  }

  return { self, stores, fetchMock, dispatch, settle, request };
}

const SHELL = `nibras-shell-${SW_VERSION}`;
const STATIC = `nibras-static-${SW_VERSION}`;

describe('service worker (public/sw.js)', () => {
  let env: ReturnType<typeof setup>;

  describe('install', () => {
    beforeEach(() => {
      env = setup();
    });

    it('precaches the three offline pages, the manifest and an icon, anonymously', async () => {
      await env.settle(env.dispatch('install'));
      const shell = env.stores.get(SHELL)!;
      expect([...shell.entries.keys()].sort()).toEqual(
        [
          '/_next/static/chunks/main.js',
          '/_next/static/css/app.css',
          '/ar/offline',
          '/en/offline',
          '/fr/offline',
          '/icons/icon-192.png',
          '/manifest.webmanifest',
        ].map((p) => `${ORIGIN}${p}`),
      );
      // Precache requests never carry the session cookies: the offline page is anonymous HTML.
      for (const [input] of env.fetchMock.mock.calls) {
        if (input instanceof Request && !input.url.includes('/_next/')) {
          expect(input.credentials).toBe('omit');
        }
      }
    });

    it("also caches the offline pages' own /_next/static assets, in the never-trimmed shell cache", async () => {
      await env.settle(env.dispatch('install'));
      const shell = [...env.stores.get(SHELL)!.entries.keys()];
      expect(shell).toContain(`${ORIGIN}/_next/static/chunks/main.js`);
      expect(shell).toContain(`${ORIGIN}/_next/static/css/app.css`);
      expect([...(env.stores.get(STATIC)?.entries.keys() ?? [])]).toEqual([]);
    });

    it('activates at once on a first install (nothing to replace)', async () => {
      await env.settle(env.dispatch('install'));
      expect(env.self.skipWaiting).toHaveBeenCalled();
    });

    it('waits on an update: the page applies it with SKIP_WAITING when the user reloads', async () => {
      env = setup({ active: true });
      await env.settle(env.dispatch('install'));
      expect(env.self.skipWaiting).not.toHaveBeenCalled();
      env.dispatch('message', { data: { type: 'SKIP_WAITING' } });
      expect(env.self.skipWaiting).toHaveBeenCalledTimes(1);
    });

    it('fails the install when an offline page redirects (e.g. to a login page)', async () => {
      env = setup({
        network: (url) =>
          url.pathname === '/ar/offline'
            ? basic('<html>login</html>', { redirected: true })
            : basic(OFFLINE_HTML('fr')),
      });
      const event = env.dispatch('install');
      await expect(Promise.all(event.waits)).rejects.toThrow();
    });
  });

  it('activate deletes the caches of other versions (and the legacy tt-* ones) and claims the clients', async () => {
    env = setup({
      existingCaches: [
        'nibras-shell-old',
        'nibras-static-old',
        // Pre-rename caches (the app was called TT): removed too.
        'tt-shell-old',
        'tt-static-old',
        'other-app',
      ],
    });
    await env.settle(env.dispatch('install'));
    await env.settle(env.dispatch('activate'));
    // (The static cache is only opened by the first `/_next/static/` fetch.)
    expect([...env.stores.keys()].sort()).toEqual(['other-app', SHELL].sort());
    expect(env.self.clients.claim).toHaveBeenCalled();
  });

  describe('fetch', () => {
    beforeEach(async () => {
      env = setup();
      await env.settle(env.dispatch('install'));
      env.fetchMock.mockClear();
    });

    it('never intercepts API calls', () => {
      const event = env.dispatch('fetch', { request: env.request('/api/v1/auth/me') });
      expect(event.responded).toBeUndefined();
    });

    it('never intercepts non-GET requests', () => {
      const event = env.dispatch('fetch', {
        request: env.request('/fr/app', { method: 'POST', mode: 'navigate' }),
      });
      expect(event.responded).toBeUndefined();
    });

    it('never intercepts cross-origin requests', () => {
      const event = env.dispatch('fetch', {
        request: { url: 'https://cdn.example.com/x.js', method: 'GET', mode: 'cors' },
      });
      expect(event.responded).toBeUndefined();
    });

    it('serves navigations from the network and never stores the (authenticated) HTML', async () => {
      const event = env.dispatch('fetch', {
        request: env.request('/ar/app', { mode: 'navigate' }),
      });
      const response = await event.responded!;
      expect(await response.text()).toBe('body of /ar/app');
      for (const store of env.stores.values()) {
        expect([...store.entries.keys()]).not.toContain(`${ORIGIN}/ar/app`);
      }
    });

    it.each([
      ['/ar/app', 'ar'],
      ['/en/app/settings/profile', 'en'],
      ['/fr', 'fr'],
      ['/', 'fr'],
      ['/de/app', 'fr'],
    ])('an offline navigation to %s gets the %s offline page', async (path, locale) => {
      env.fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      const event = env.dispatch('fetch', { request: env.request(path, { mode: 'navigate' }) });
      const response = await event.responded!;
      expect(await response.text()).toContain(`offline ${locale}`);
    });

    it('serves /_next/static cache-first and stores successful responses', async () => {
      const first = env.dispatch('fetch', { request: env.request('/_next/static/chunks/a.js') });
      expect(await (await first.responded!).text()).toBe('body of /_next/static/chunks/a.js');
      await env.settle(first);
      expect(env.fetchMock).toHaveBeenCalledTimes(1);
      const second = env.dispatch('fetch', { request: env.request('/_next/static/chunks/a.js') });
      expect(await (await second.responded!).text()).toBe('body of /_next/static/chunks/a.js');
      expect(env.fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not store a static response that is an error, private or no-store', async () => {
      env.fetchMock.mockImplementation(async (input: unknown) => {
        const path = new URL((input as { url: string }).url).pathname;
        if (path.endsWith('404.js')) return basic('nope', { status: 404 });
        return basic('x', { headers: { 'cache-control': 'private, no-store' } });
      });
      for (const path of ['/_next/static/404.js', '/_next/static/private.js']) {
        await env.settle(env.dispatch('fetch', { request: env.request(path) }));
        expect(await env.stores.get(STATIC)?.match(`${ORIGIN}${path}`)).toBeUndefined();
      }
    });

    it('trims the static cache to 300 entries, oldest first, never evicting the offline assets', async () => {
      const assets = ['/_next/static/css/app.css', '/_next/static/chunks/main.js'];
      for (let i = 0; i < 310; i += 1) {
        const event = env.dispatch('fetch', { request: env.request(`/_next/static/c/${i}.js`) });
        await event.responded; // `waitUntil` (store, then trim) is called before the response settles
        await env.settle(event);
      }
      const statics = [...env.stores.get(STATIC)!.entries.keys()];
      expect(statics).toHaveLength(300);
      expect(statics[0]).toBe(`${ORIGIN}/_next/static/c/10.js`);
      // Offline, the offline page still gets its own styles and scripts.
      env.fetchMock.mockClear();
      env.fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      for (const path of assets) {
        const event = env.dispatch('fetch', { request: env.request(path) });
        expect(await (await event.responded!).text()).toBe(`body of ${path}`);
      }
      expect(env.fetchMock).not.toHaveBeenCalled();
    });

    it('serves the precached manifest and icon from the shell cache (offline too)', async () => {
      env.fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      for (const path of ['/manifest.webmanifest', '/icons/icon-192.png']) {
        const event = env.dispatch('fetch', { request: env.request(path) });
        expect(await (await event.responded!).text()).toBe(`body of ${path}`);
      }
      expect(env.fetchMock).not.toHaveBeenCalled();
    });

    it('leaves every other request to the network', () => {
      for (const path of ['/fr/app?_rsc=1', '/icons/icon-512.png', '/health']) {
        expect(env.dispatch('fetch', { request: env.request(path) }).responded).toBeUndefined();
      }
    });
  });
});
