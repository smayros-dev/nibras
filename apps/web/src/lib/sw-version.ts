/**
 * Version of the service worker's caches: `SwRegister` registers `/sw.js?v=${SW_VERSION}` and the
 * worker names its caches `nibras-shell-${v}` / `nibras-static-${v}`, deleting every other version's on
 * activation. Bump it when the precached offline pages must be refetched (new copy, new layout)
 * or the cache layout changes; edits to `public/sw.js` itself are picked up by the browser's
 * byte-for-byte update check either way (`/sw.js` is served `Cache-Control: no-cache`).
 */
export const SW_VERSION = '1';
