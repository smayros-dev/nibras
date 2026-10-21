# Frontend runbook

Spec: `docs/superpowers/specs/2026-10-17-sp1.5-frontend-ui-design.md`; PRD §8.16.1 (i18n/RTL),
§9 (navigation), §14.1 (budget), §14.5 (accessibility), §14.6 (PWA), §14.7 (headers). Day-to-day
commands and the e2e modes are in [local-dev.md](local-dev.md); this page is how the frontend is
built and how to change it safely.

## Map

| Where                                    | What                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/ui/src/tokens.css`             | design tokens: brand scale, semantic colours (light/dark), type, radius, shadow, motion |
| `packages/ui/src/brand.ts`               | `BRAND` (name, theme colours) for the manifest and `<meta name="theme-color">`          |
| `packages/ui/src/*.tsx`, `shell/`        | the component library (Radix primitives) and the app shell, exported from `index.ts`    |
| `apps/web/src/lib/navigation.ts`         | `buildNavModel`: the shell's sections and items, by role                                |
| `apps/web/src/lib/security-headers.ts`   | `buildCsp`, `securityHeaders` (used by `src/proxy.ts` and `next.config.ts`)             |
| `apps/web/public/sw.js`                  | the service worker (hand-written); `src/lib/sw-version.ts` holds `SW_VERSION`           |
| `packages/i18n/messages/{fr,ar,en}.json` | the catalogues (fr first; ar and en mirror its keys)                                    |

## Tokens and theming

- Components use **semantic** tokens only (`bg-surface`, `text-fg-muted`, `border-border`,
  `bg-primary`, `text-primary-fg`, `*-danger`, `*-warning`, `*-success`, `*-info`), never the raw
  `brand-*`/`accent-*` scales and never `dark:` colour classes (the tokens switch under
  `[data-theme='dark']`). A new semantic colour gets a light and a dark value in `tokens.css` and
  a pair in `tokens.test.ts`, which enforces WCAG AA contrast in both themes.
- The theme (`light` / `dark` / `system`) is per browser: `next-themes` stores it in
  `localStorage` `nibras-theme` and sets `data-theme` on `<html>` before first paint with an inline
  script that carries the request's CSP nonce.
- **Direction.** Logical utilities only (`ps-*`, `me-*`, `start-0`, `text-start`, `rounded-s-*`,
  `border-s`). The logical-CSS lint rule (`packages/config/eslint/logical-css.mjs`) fails
  `pnpm lint` on any physical left/right class in `apps/web` and `packages/ui`; the one exception
  is `rtl:-scale-x-100` on directional icons (chevrons, arrows). Test files are exempt (prose).

### Rebranding

1. `packages/ui/src/brand.ts`: `BRAND.name`, `shortName`, `themeColor` (= light
   `--color-primary`), `backgroundColor` (= light `--color-bg`), `darkThemeColor` (= dark
   `--color-bg`).
2. `packages/ui/src/tokens.css`: the brand block (`--color-brand-50…950`, accent, font); run
   `pnpm --filter @nibras/ui test` (contrast) afterwards.
3. `apps/web/public/icons/icon.svg`: the mark on a `<rect fill="#rrggbb">` background.
4. `pnpm --filter @nibras/web icons` (`scripts/icons.mjs`, sharp) re-renders `icon-192.png`,
   `icon-512.png`, `maskable-512.png` and `apple-touch-icon.png`; commit the PNGs.
5. `common.appName` in the three catalogues; bump `SW_VERSION` so installed workers refetch the
   offline pages.

## Adding a component

1. `packages/ui/src/<name>.tsx` (+ `<name>.test.tsx`), exported from `src/index.ts`. Build on a
   Radix primitive when one exists (focus, keyboard and ARIA come with it); take every visible
   string as a prop (the library has no i18n); size touch targets with `--size-touch`.
2. A file that sets an event handler or holds state starts with `'use client'`
   (`client-boundary.test.ts` fails otherwise: a server page cannot pass functions to it).
3. Tests render in both directions (`renderWithDir`) and call `expectNoPhysicalClasses`.
4. `@nibras/ui` is source-exported: the web app picks changes up without a build.

## Adding a nav item

Add it to `buildNavModel` (`apps/web/src/lib/navigation.ts`) in PRD §9.1 order: `id`, a
locale-less `href` (and `match` when the active prefix differs), `label: t('nav.<key>')`, a lucide
icon imported by name (tree-shaken; never `import *`), and its role condition. Add `nav.<key>` to
the three catalogues and a case to `navigation.test.ts`. Items for routes that do not exist yet are
not added: the owning sub-project adds the item with its route (SP3 courses, SP4 students, SP5
sessions, SP8 messages, SP9 notifications).

## i18n workflow

- Every key goes into `fr`, `ar` and `en` in the same commit (French first; AR/EN translations
  await native review, PRD §22). Western digits in Arabic (D-P16): never hard-code Arabic-Indic
  numerals; `formatDate`/`Intl` handle it. Plurals use `{min}`/`{max}` arguments, not `#`.
- The web reads `@nibras/i18n`'s **dist**: after editing a catalogue run
  `pnpm --filter @nibras/i18n build` (turbo does it before `dev`, `build` and `test`).
- `pnpm --filter @nibras/i18n test` runs two guards:
  - `locales.test.ts`: the three catalogues have exactly the same keys, none empty;
  - `unused-keys.test.ts`: every key is referenced by `apps/web/src` or `packages/ui/src` (tests
    excluded) — as a full string literal, or as a namespace passed to
    `useTranslations`/`getTranslations` plus the rest of the key. `errors.*` (one per API code),
    `emails.*` and `sms.*` (rendered by the API) are not scanned. A key built at run time
    (``t(`members.role_${role}`)``) needs its prefix in `DYNAMIC_KEYS` with a comment naming the
    call; a prefix that matches no key fails too. Delete the keys it flags rather than
    allow-listing them. Turbo lists those source trees as inputs of `@nibras/i18n#test`.

## First-load JS budget (PRD §14.1)

PRD §14.1: initial JS of a student route < 250 kB gzip (video player excluded, loaded on demand).
Next 16 (Turbopack) no longer prints "First Load JS", so `apps/web/scripts/first-load-js.mjs`
computes it from the build manifests: the root main files plus every chunk the route's segments
load up front, each once, gzip -9 (the `nomodule` polyfill is not counted).

```sh
pnpm --filter @nibras/web build && pnpm --filter @nibras/web budget
```

It prints every route and exits 1 when one is over; CI runs it after `pnpm build` (`check` job).
Measured at the close of SP1.5 (2026-10-17):

| Route                              | First-load JS (gzip) |
| ---------------------------------- | -------------------- |
| `/[locale]/app` (dashboard)        | 226.4 kB             |
| `/[locale]/2fa/setup` (largest)    | 233.8 kB             |
| `/[locale]` (landing)              | 220.8 kB             |
| floor (`/[locale]/[...rest]`, 404) | 219.9 kB             |

About 131 kB is React and Next themselves and ≈ 56 kB the Radix layer (dialogs, menus, toasts) of
the shell. Headroom is ≈ 16–30 kB per route, so:

- **Never import a value from `@nibras/contracts` in web code.** That entry bundles every zod schema
  and zod itself: one constant imported from it put every route at ≈ 300 kB. Values come from the
  zod-free `@nibras/contracts/web`; type-only imports from `@nibras/contracts` are erased and fine.
  ESLint enforces it in `src/` (`@typescript-eslint/no-restricted-imports`,
  `packages/config/eslint/next.mjs`; tests exempt); a server component that needs a schema-module
  value disables the rule on that import with a comment. `packages/contracts/src/web.test.ts`
  keeps the web entry zod-free.
- Import lucide icons by name; load heavy page-local libraries (the future video player, the
  Tiptap editor) with `next/dynamic` or `await import()`.

## Security headers

### Where the headers come from

| Header                                                                                                                                                          | Set by                                                                                          | Paths                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy` (per-request nonce)                                                                                                                   | `apps/web/src/proxy.ts` via `buildCsp`                                                          | pages (the proxy matcher: everything except `/api/`, `/health*`, `/_next`, known static file extensions — `/fr/x.y` still gets it) |
| `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Strict-Transport-Security` (production only) | `securityHeaders` — from the proxy on pages and from `next.config.ts` `headers()` on every path | all                                                                                                                                |
| `Cache-Control: no-cache`                                                                                                                                       | `next.config.ts`                                                                                | `/sw.js`                                                                                                                           |

Both live in `apps/web/src/lib/security-headers.ts`; change them there only.

### The policy

Production (`NODE_ENV !== 'development'`):

```
default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: <media>; font-src 'self'; connect-src 'self' <media>; worker-src 'self' blob:;
manifest-src 'self'; media-src 'self' blob: <media>; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
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

### Allowing a new origin

**Media origins (SP3).** `MEDIA_ORIGINS` (space- or comma-separated `http(s)` origins; anything
else is dropped by `parseOrigins`) is read once by `proxy.ts` at start-up and added to
`connect-src` (presigned upload `PUT`s, pdf.js fetching the inline PDF, hls.js fetching manifests
and segments), `media-src` (native MP4/HLS playback) and `img-src` (VOD thumbnails) — nowhere
else. Locally and in CI it is the MinIO endpoint (`http://localhost:9000`); in production the
object store's public endpoint plus the Cloudflare Stream customer subdomain. It is a runtime
variable of the web server (also listed in `turbo.json` `build.env` and the CI workflow).
`worker-src 'self' blob:`: pdf.js's worker is bundled under `_next/static` (never a CDN) and
hls.js runs its transmuxer in a `blob:` worker. The players load hls.js / pdf.js with a plain
`import()` inside an effect (never `next/dynamic` around an app component: Turbopack then
duplicates shared app modules into every route), and an MP4 never loads hls.js.

Upcoming: **LiveKit (SP6)** needs its `wss://` URL in `connect-src`.

1. Add it to the narrowest directive in `buildCsp` (e.g. a VOD CDN → `media-src`, LiveKit →
   `connect-src` with its `wss:` URL; a media host → `MEDIA_ORIGINS`), never to `default-src`,
   never `*`.
2. Add the expectation to `src/lib/security-headers.test.ts`.
3. Scripts: with `'strict-dynamic'`, host allow-lists are ignored by modern browsers; load a
   third-party script through `next/script` with `nonce={(await headers()).get('x-nonce')}`.

### Debugging a violation

- The browser console prints a `Refused to …` error naming the violated directive; that directive
  tells you what to change.
- `curl -sI http://localhost:3000/fr/login | grep -i content-security` shows the live policy.
- A script refused for its nonce: it was injected without the request nonce — use `next/script`
  with the nonce, or render it from a server component that reads `x-nonce`.
- A page served from a static cache (no `Content-Security-Policy` header, or the same nonce on two
  loads) has lost dynamic rendering — check that it renders under `[locale]/layout.tsx`.
- `e2e/headers.spec.ts` asserts the headers, the per-request nonce, the nonce on every `<script>`
  and an empty CSP console.

## PWA

Icons, the worker's cache policy, `SW_VERSION` and local testing are in
[local-dev.md](local-dev.md#pwa-icons-and-service-worker). Operator notes:

- **The offline page reuses one nonce.** The worker caches `/{locale}/offline` at install,
  response headers included, so every offline load serves the nonce of that one response.
  Accepted: the page is anonymous and static (no user data, no query-driven or injectable
  content), so a known nonce gives an attacker nothing to attach a script to. (This is also why
  "the same nonce on two loads" above is expected for the offline page only.)
- Navigations are network-only (they can carry user data); only `/_next/static/`, the offline
  pages, the manifest and one icon are cached; `/api/*` is never intercepted.

## Environments

- **HSTS is gated on `NODE_ENV=production`**, not on `APP_ENV`: every `next build` sends
  `Strict-Transport-Security: max-age=31536000; includeSubDomains` and the CSP's
  `upgrade-insecure-requests`, staging included. **Staging must be served over HTTPS**: a browser
  that has seen the header refuses plain HTTP on that host (and its subdomains) for a year.
  Local production runs on `127.0.0.1`, where browsers ignore HSTS.
- **E2E against the production build** (what CI runs): stop any dev server on 3000–3002, then

  ```sh
  pnpm build
  E2E_PROD=1 pnpm --filter @nibras/web e2e            # every project
  E2E_PROD=1 pnpm --filter @nibras/web e2e consent    # one spec file
  ```

  On PowerShell: `$env:E2E_PROD='1'; pnpm --filter @nibras/web e2e`. Playwright starts the
  standalone web server (`start:standalone`) and the api/worker from `dist`. The strict CSP, HSTS
  and the service-worker test only run in this mode. Details:
  [local-dev.md](local-dev.md#end-to-end-tests-playwright).

## Known residuals (FIX-LATER)

- AR and EN copy are the implementer's translations; native review of `ar.json`, with the
  `rtl-screens` CI artefact, is a PRD §22 follow-up.
- `style-src 'unsafe-inline'` (see the policy) stays until Radix positions without inline styles.
- A server navigation with an expired access token passes through `/auth/resume` (one extra round
  trip); an API-set marker cookie would remove it, but that is a backend change (SP1 rule).
- If a consent version changes between the web and the API (deploy skew), the gate re-renders
  after accept with the same pending list and the button is usable again; the user is not told
  why. Deploy web and API together when `CONSENT_VERSIONS` changes.
- `environmentMatchGlobs` in `apps/web/vitest.config.ts` is deprecated (Vitest 3.2); move to
  `test.projects` with Vitest 4.
- First-load headroom is ≈ 16–30 kB: a sub-project adding a global client dependency re-runs
  `pnpm --filter @nibras/web budget` before merging (CI fails it anyway).
