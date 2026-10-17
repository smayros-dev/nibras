/*
 * Nibras service worker: hand-written, no build step (spec D6). CSP-neutral: same-origin only,
 * no inline code. Registered by `SwRegister` as `/sw.js?v=<SW_VERSION>` in production builds.
 *
 * Cache policy — only two things are ever stored:
 *   - `tt-shell-<v>`: the three offline pages (fetched anonymously, `credentials: 'omit'`), the
 *     manifest and one icon, at install;
 *   - `tt-static-<v>`: `/_next/static/` (content-hashed, public, immutable), cache-first.
 * Never cached: `/api/*` (not even intercepted), HTML navigations (they may carry user data:
 * network only, the offline page on failure), non-GET and cross-origin requests, and any
 * response that is an error, redirected, `private`/`no-store` or sets a cookie. (`Set-Cookie` is
 * never exposed to a worker nor stored by Cache Storage; the precache uses `credentials: 'omit'`,
 * so the browser also ignores the `NEXT_LOCALE` cookie the offline page's response sets.)
 */
'use strict';

const VERSION = new URL(self.location.href).searchParams.get('v') || '0';
const SHELL_CACHE = 'tt-shell-' + VERSION;
const STATIC_CACHE = 'tt-static-' + VERSION;
const OWN_CACHE = /^tt-(shell|static)-/;
const LOCALES = ['fr', 'ar', 'en'];
const DEFAULT_LOCALE = 'fr';
const MAX_STATIC_ENTRIES = 300;
const ORIGIN = self.location.origin;
const OFFLINE_PAGES = LOCALES.map((locale) => '/' + locale + '/offline');
const PRECACHE = OFFLINE_PAGES.concat(['/manifest.webmanifest', '/icons/icon-192.png']);

const absolute = (path) => new URL(path, ORIGIN).href;

function storable(response) {
  if (!response || !response.ok || response.redirected || response.type !== 'basic') return false;
  if (response.headers.has('set-cookie')) return false;
  return !/no-store|private/i.test(response.headers.get('cache-control') || '');
}

async function precache() {
  const shell = await caches.open(SHELL_CACHE);
  const statics = await caches.open(STATIC_CACHE);
  await Promise.all(
    PRECACHE.map(async (path) => {
      const request = new Request(absolute(path), { credentials: 'omit', cache: 'reload' });
      const response = await fetch(request);
      // A redirect (to a login page, say) or an error must not become the offline page.
      if (!response.ok || response.redirected) throw new TypeError('precache ' + path);
      if (OFFLINE_PAGES.includes(path)) {
        // The offline page's own scripts and styles, so it renders (and hydrates) offline.
        const html = await response.clone().text();
        const assets = new Set(html.match(/\/_next\/static\/[^"'\s\\<>)]+/g) || []);
        await Promise.all(
          Array.from(assets, (asset) =>
            statics.add(new Request(absolute(asset), { credentials: 'omit' })).catch(() => {}),
          ),
        );
      }
      await shell.put(request, response);
    }),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precache().then(() => {
      // First install: nothing to replace, take over at once. An update waits until the user
      // accepts the "new version" toast (a form may be dirty): the page then posts SKIP_WAITING.
      if (!self.registration.active) return self.skipWaiting();
      return undefined;
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => OWN_CACHE.test(name) && name !== SHELL_CACHE && name !== STATIC_CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function localeOf(pathname) {
  const segment = pathname.split('/')[1];
  return LOCALES.includes(segment) ? segment : DEFAULT_LOCALE;
}

async function networkOrOffline(request, url) {
  try {
    return await fetch(request);
  } catch (error) {
    const offline = await caches.match(absolute('/' + localeOf(url.pathname) + '/offline'), {
      cacheName: SHELL_CACHE,
    });
    if (offline) return offline;
    throw error;
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  await Promise.all(
    keys.slice(0, Math.max(0, keys.length - MAX_STATIC_ENTRIES)).map((key) => cache.delete(key)),
  );
}

async function cacheFirst(event) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const response = await fetch(event.request);
  if (storable(response)) {
    event.waitUntil(
      cache
        .put(event.request, response.clone())
        .then(() => trim(cache))
        .catch(() => {}),
    );
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== ORIGIN || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkOrOffline(request, url));
  } else if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(event));
  }
  // Everything else (RSC payloads, icons, /health, …): the browser's own network handling.
});
