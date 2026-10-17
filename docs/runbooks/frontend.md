# Frontend runbook — security headers

Spec: `docs/superpowers/specs/2026-10-17-sp1.5-frontend-ui-design.md` (D7, D8), PRD §14.7.

## Where the headers come from

| Header                                                                                                                                                          | Set by                                                                                          | Paths                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy` (per-request nonce)                                                                                                                   | `apps/web/src/proxy.ts` via `buildCsp`                                                          | pages (the proxy matcher: everything except `/api/`, `/health*`, `/_next`, files with an extension) |
| `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Strict-Transport-Security` (production only) | `securityHeaders` — from the proxy on pages and from `next.config.ts` `headers()` on every path | all                                                                                                 |
| `Cache-Control: no-cache`                                                                                                                                       | `next.config.ts`                                                                                | `/sw.js`                                                                                            |

Both live in `apps/web/src/lib/security-headers.ts`; change them there only.

## The policy

Production (`NODE_ENV !== 'development'`):

```
default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self';
media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
upgrade-insecure-requests
```

Development adds `'unsafe-eval'` to `script-src` (React's dev tooling) and `ws: wss:` to
`connect-src` (HMR), and drops `upgrade-insecure-requests` and HSTS.

- **Nonce.** 16 bytes from `crypto.getRandomValues`, base64, new on every request. The proxy puts
  it in the request's CSP header (Next reads it there and stamps its own scripts) and in `x-nonce`
  (the root layout passes it to next-themes' `ThemeProvider`). Both request headers are always
  overwritten, so a client cannot pick the nonce.
- **Every page is dynamically rendered** (D8): a static page would bake in one nonce for everyone.
  The root `[locale]/layout.tsx` reads `headers()`, which makes the whole tree dynamic.
- **`style-src 'unsafe-inline'` — accepted residual risk.** Server-rendered `style=""` attributes
  (Radix positioning, React) cannot carry a nonce and would be dropped. An injected stylesheet
  cannot run script, and exfiltration through CSS is contained by `img-src`, `font-src` and
  `connect-src` being same-origin (plus `data:`/`blob:` for images, which cannot leave the page).
- `img-src data: blob:` serves the 2FA QR code and the recovery-code download.

## Allowing a new origin

1. Add it to the narrowest directive in `buildCsp` (e.g. a VOD CDN → `media-src`, LiveKit →
   `connect-src` with its `wss:` URL), never to `default-src`, never `*`.
2. Add the expectation to `src/lib/security-headers.test.ts`.
3. Scripts: with `'strict-dynamic'`, host allow-lists are ignored by modern browsers; load a
   third-party script through `next/script` with `nonce={(await headers()).get('x-nonce')}`.

## Debugging a violation

- The browser console prints a `Refused to …` error naming the violated directive; that directive
  tells you what to change.
- `curl -sI http://localhost:3000/fr/login | grep -i content-security` shows the live policy.
- A script refused for its nonce: it was injected without the request nonce — use `next/script`
  with the nonce, or render it from a server component that reads `x-nonce`.
- A page served from a static cache (no `Content-Security-Policy` header, or the same nonce on two
  loads) has lost dynamic rendering — check that it renders under `[locale]/layout.tsx`.
- `e2e/headers.spec.ts` asserts the headers, the per-request nonce, the nonce on every `<script>`
  and an empty CSP console.
