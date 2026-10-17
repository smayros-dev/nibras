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
 * - `worker-src`/`manifest-src 'self'` for the PWA service worker and manifest.
 */
export function buildCsp(nonce: string, { dev }: { dev: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
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
