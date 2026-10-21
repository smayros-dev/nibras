/**
 * Security headers (spec D7, PRD §14.7). The CSP is per request (nonce) and set by `proxy.ts` on
 * HTML responses; the static headers are also sent on every path by `next.config.ts`.
 * Runbook: docs/runbooks/frontend.md.
 */

/**
 * - Scripts: only those carrying the request nonce (Next applies it to its own scripts and
 *   next-themes takes it as a prop); `'strict-dynamic'` lets them load their chunks. Dev adds
 *   `'unsafe-eval'` (React's dev error overlays use `eval`).
 * - Styles: `'unsafe-inline'` because SSR'd `style=""` attributes (Radix, React) cannot carry a
 *   nonce — documented residual risk, contained by the same-origin `connect/img/font-src`.
 * - `img-src data: blob:` for the 2FA QR code and the recovery-code download.
 * - `connect-src 'self'`: the API is same-origin (`/api` rewrite); dev adds the HMR websocket.
 * - `mediaOrigins` (`MEDIA_ORIGINS`: the object store's public origin, the managed VOD's
 *   playback/thumbnail origins) go to `connect-src` (presigned upload `PUT`s, pdf.js fetching the
 *   inline PDF, hls.js fetching the manifest and segments), `media-src` (native MP4/HLS playback)
 *   and `img-src` (VOD thumbnails) — never to `default-src` or `script-src`.
 * - `worker-src 'self' blob:`: the PWA service worker and the pdf.js worker are same-origin
 *   (`_next/static`); hls.js runs its transmuxer in a `blob:` worker.
 * - `manifest-src 'self'` for the PWA manifest.
 */
export function buildCsp(
  nonce: string,
  { dev, mediaOrigins = [] }: { dev: boolean; mediaOrigins?: readonly string[] },
): string {
  const media = mediaOrigins.map((origin) => ` ${origin}`).join('');
  const connect = ["'self'", ...mediaOrigins, ...(dev ? ['ws:', 'wss:'] : [])].join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${media}`,
    "font-src 'self'",
    `connect-src ${connect}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    `media-src 'self' blob:${media}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/**
 * `MEDIA_ORIGINS` (comma- or space-separated URLs) → bare `http(s)` origins; anything that is not
 * an absolute http(s) URL (`*`, schemes, garbage) is dropped, so the policy never widens to it.
 */
export function parseOrigins(value: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (value ?? '').split(/[\s,]+/)) {
    if (!part) continue;
    try {
      const url = new URL(part);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !out.includes(url.origin)) {
        out.push(url.origin);
      }
    } catch {
      // Not a URL: ignored.
    }
  }
  return out;
}

/** Headers for every response; HSTS only in production (dev runs on plain http://localhost). */
export function securityHeaders({ dev }: { dev: boolean }): Record<string, string> {
  return {
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // camera/microphone for the live room (SP6), same origin only.
    'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=()',
    ...(dev ? {} : { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }),
  };
}

/** A fresh CSP nonce: base64 of 16 bytes from the Web Crypto CSPRNG (Node and Edge runtimes). */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
