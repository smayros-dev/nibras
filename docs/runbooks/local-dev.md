# Local development

How to run the platform on a developer machine (Windows 11 + Git Bash or PowerShell, macOS, Linux).
This page covers what SP0 (monorepo & infrastructure) delivers; later plans append to it.
Frontend conventions (tokens, components, nav, i18n guards, first-load budget, CSP, PWA,
rebranding) are in [frontend.md](frontend.md). The security rules (secrets, scanners, images,
GitHub settings) are summarised in [security.md](security.md).

## Prerequisites

- **Node.js 22 LTS, 22.18 or later** (`engines.node`): the major is pinned in `.node-version`
  (fnm, nvm-windows, Volta and most version managers read it). 22.18 runs `.ts` files directly
  (type stripping), which `pnpm db:seed` relies on.
- **pnpm 10** via corepack: `corepack enable` once; the exact version is pinned by `packageManager`
  in the root `package.json`.
- **Docker Desktop** (with Docker Compose v2): runs Postgres, Redis, Mailpit and MinIO.

## First run

In this order:

```bash
pnpm install
cp .env.example .env   # PowerShell: Copy-Item .env.example .env
docker compose up -d   # Postgres, Redis, Mailpit, MinIO (init.sql creates roles and databases)
pnpm db:migrate        # migrate the dev database `nibras`
pnpm db:migrate:test   # migrate the test databases nibras_db_test, nibras_api_test, nibras_worker_test
pnpm --filter @nibras/api s3:init -- --test   # MinIO buckets: nibras-dev and the three test buckets
pnpm dev               # docker compose up -d (no-op now), then turbo run dev
```

`pnpm dev` starts the infrastructure containers in the background, then every app in watch mode.
Stop the apps with `Ctrl+C`; stop the containers with `docker compose down`
(add `-v` to also drop the data volumes).

`init.sql` only runs on an empty Postgres volume. On a volume created before the per-package test
databases existed, `pnpm db:migrate:test` still works: Prisma creates a missing database
(`app_system` has `CREATEDB`). Re-run it after pulling new migrations, like `pnpm db:migrate`.

**Volumes from before the rename to Nibras.** The compose project was called `tt`; its volumes are
pinned to their old names (`tt_postgres-data`, `tt_minio-data`) so the data is kept. Such a volume
has the old `tt*` databases and no `nibras` ones: stop the old containers once
(`docker compose -p tt down`, without `-v`), `docker compose up -d`, then run the `CREATE DATABASE` lines of `infra/docker/postgres/init.sql`
(`docker compose exec postgres psql -U postgres -c "CREATE DATABASE nibras OWNER app_system;"`,
and so on; the roles already exist). Update `.env` from `.env.example` (database names,
`EMAIL_FROM`, `S3_BUCKET`), then `pnpm db:migrate`, `pnpm db:migrate:test` and `pnpm db:seed`. The
old `tt*` databases stay untouched until you drop them.

### Demo data (`pnpm db:seed`)

```bash
pnpm db:seed           # builds @nibras/db (and @nibras/contracts), then runs packages/db/prisma/seed.ts
```

Fills the dev database `nibras` with demo accounts, their personal workspaces and the organisation
_Académie El Manar_ (`academie-el-manar`, TN): members in every role, teacher ↔ student
assignments, teacher profiles, consent history, an audit log and two abuse reports. Re-running it
is safe (idempotent): rows are upserted, history is only added while the organisation has none,
and a password hash is rewritten only when it no longer matches, which then bumps the user's
`credentialsVersion` (their open sessions end).

Every account uses the password **`mot-de-passe-demo-2026`**:

| Email                  | Role in the organisation         | Notes                                    |
| ---------------------- | -------------------------------- | ---------------------------------------- |
| `amine@example.test`   | OWNER                            | phone verified; first login forces 2FA   |
| `leila@example.test`   | TEACHER                          | marketing consent; assigned to Yassine   |
| `karim@example.test`   | TEACHER                          | Europe/Paris; assigned to Noussa         |
| `sana@example.test`    | ASSISTANT                        | Arabic UI                                |
| `rajaa@example.test`   | GUARDIAN                         |                                          |
| `yassine@example.test` | STUDENT (minor)                  | no personal workspace                    |
| `noussa@example.test`  | STUDENT                          | no personal workspace                    |
| `tarek@example.test`   | STUDENT (`SUSPENDED_NO_CONSENT`) | minor without guardian consent; reported |

The super-admin console needs its own account (`pnpm --filter @nibras/api cli create-super-admin`,
[auth-and-tenancy.md](auth-and-tenancy.md)). The seed is for local development only: it refuses
to run (exit 1) unless `APP_ENV` is unset or `development`, `NODE_ENV` is not `production`, and
the host of `DATABASE_URL_SYSTEM` is `localhost`, `127.0.0.1` or `::1`. Any other host, including
the compose service name `postgres` (staging uses the same host name, and its `.env` may still say
`APP_ENV=development`), is refused unless `SEED_ALLOW_HOST` names that exact host, for example
`SEED_ALLOW_HOST=postgres pnpm db:seed` from inside the compose network. Never set it on staging.
`argon2` and `@nibras/contracts` are dev dependencies of `@nibras/db`: only the seed uses them.

### Migrations

New migration (from `packages/db`'s schema), extra arguments go after `--`:

```bash
pnpm --filter @nibras/db migrate:dev -- --name add_users --create-only
```

TypeScript configs extend the shared ones without the `.json` extension
(`"extends": "@nibras/config/tsconfig/nest"`): `@nibras/config`'s `exports` map `./tsconfig/*` to
`./tsconfig/*.json`.

## Ports

| Service       | Port | URL                               |
| ------------- | ---- | --------------------------------- |
| web (Next)    | 3000 | http://localhost:3000             |
| api (Nest)    | 3001 | http://localhost:3001/api/v1      |
| worker        | 3002 | http://localhost:3002/health/live |
| Postgres      | 5432 | `postgresql://localhost:5432`     |
| Redis         | 6379 | `redis://localhost:6379`          |
| Mailpit SMTP  | 1025 | `smtp://localhost:1025`           |
| Mailpit UI    | 8025 | http://localhost:8025             |
| MinIO API     | 9000 | http://localhost:9000             |
| MinIO console | 9001 | http://localhost:9001             |

- **Mailpit UI** (every email sent locally lands here): http://localhost:8025
- **MinIO console** (S3-compatible object storage; credentials in `.env`): http://localhost:9001

Each app exposes `/health/live` and `/health/ready` (the API serves them outside `/api/v1`).

## Common commands

| Command                | What it does                                   |
| ---------------------- | ---------------------------------------------- |
| `pnpm lint`            | ESLint in every package (`turbo run lint`)     |
| `pnpm typecheck`       | `tsc --noEmit` in every package                |
| `pnpm test`            | Vitest unit/integration tests in every package |
| `pnpm e2e`             | Playwright end-to-end tests                    |
| `pnpm build`           | Production build of every package              |
| `pnpm format`          | Prettier write (`pnpm format:check` to verify) |
| `pnpm db:migrate`      | Apply/create Prisma migrations (`@nibras/db`)  |
| `pnpm db:migrate:test` | Apply migrations to the three test databases   |
| `pnpm db:generate`     | Regenerate the Prisma client (`@nibras/db`)    |
| `pnpm db:seed`         | Load the local demo data (dev database only)   |

Run a task for a single package with a filter, e.g. `pnpm --filter @nibras/api test` or
`pnpm turbo run test --filter=@nibras/api`.

## End-to-end tests (Playwright)

Projects: `chromium-fr`, `chromium-ar` (desktop), `mobile-fr`, `mobile-ar` (Pixel 7). The docker
stack must be up and migrated. Two modes (`apps/web/playwright.config.ts`):

- **Dev mode** (default): `pnpm --filter @nibras/web e2e`. Playwright starts (or reuses) the api,
  worker and `next dev` servers; `e2e/warmup.ts` compiles every route first. The service-worker
  test is skipped (the SW registers only on production builds).
- **Production mode** (CI, or `E2E_PROD=1`): `pnpm build && E2E_PROD=1 pnpm --filter @nibras/web e2e`.
  Every server runs its build: the web app is the standalone server the container runs
  (`pnpm --filter @nibras/web start:standalone`, `scripts/start-standalone.mjs`: copies `public/` and
  `.next/static` next to `server.js`, listens on 127.0.0.1:3000), and the api/worker run `dist`
  (a `nest start --watch` server restarts when its watcher fires, failing in-flight requests).
  The strict production CSP and HSTS apply and the SW test runs. API and web honour the e2e TERMS
  override only with `APP_ENV=development` (an allow-list, whatever `NODE_ENV` says; the
  Playwright config sets it for both servers). In CI every
  `reuseExistingServer` is `false`: a stray server fails the run. On Windows the standalone build
  may need Developer Mode (symlinks); when it fails, use dev mode.

Rules the suite follows: no fixed sleeps for UI state (Playwright auto-waits; `expect.poll` or
`toPass` for external systems); a `429` is retried after its `Retry-After`
(`e2e/helpers/retry.ts`); transport retries (`postTransient`, `uiLogin`) apply to dev mode only.
`e2e/a11y.spec.ts` runs axe (WCAG 2 A/AA, serious and critical fail) on the main pages in fr and
ar, desktop and mobile, and saves full-page screenshots to `apps/web/test-results/screens/<project>/`
(the CI artefact `rtl-screens`, for the RTL recette).

Integration tests need the containers running (`docker compose up -d`) and migrated test databases
(`pnpm db:migrate:test`). They read `DATABASE_URL_TEST`, `DATABASE_URL_TEST_SYSTEM` and
`REDIS_URL_TEST` from the environment / `.env` as **bases**: turbo runs the packages' tests in
parallel, so each package's Vitest setup derives its own database and Redis index
(`packages/config/vitest/test-env.mjs`):

| Package          | Database             | Redis DB |
| ---------------- | -------------------- | -------- |
| `@nibras/db`     | `nibras_db_test`     | 13       |
| `@nibras/api`    | `nibras_api_test`    | 14       |
| `@nibras/worker` | `nibras_worker_test` | 15       |

Within a package, spec files run one at a time (`fileParallelism: false`).

**Parallel worktrees.** Several git worktrees can share the one compose stack when each gets its own
test databases and Redis indexes. In the worktree's `.env` (a copy of the root one) set
`TEST_DB_PREFIX` (e.g. `nibras_t1`: databases `nibras_t1_db_test`, `nibras_t1_api_test`, `nibras_t1_worker_test`;
keep the `_test` suffix that `resetDatabase` requires, which the derivation appends) and
`TEST_REDIS_DB_BASE` (an integer 1..13; the packages use `base`, `base+1`, `base+2`, e.g. `10` for
the first worktree and `7` for the second, while the main checkout keeps the default `13`), then
run `pnpm db:migrate:test` in the worktree (Prisma creates the missing databases). Drop the
`<prefix>_*_test` databases when the worktree is removed.

**MinIO test buckets (SP3).** `@nibras/providers`, `@nibras/api` and `@nibras/worker` tests use the
compose MinIO, each in its own bucket derived from `S3_BUCKET_TEST` (`nibras-test` →
`nibras-providers-test`, `nibras-api-test`, `nibras-worker-test`), created on demand and emptied by
the suites. A parallel worktree sets its own base too (e.g. `S3_BUCKET_TEST=nibras-t1-test` →
`nibras-t1-api-test`, …). Without `S3_ENDPOINT` the providers' MinIO suite is skipped; the API and
worker suites need MinIO running (`docker compose up -d`): the API and the worker refuse to start
without `S3_*`, and the API test app creates and empties its bucket (it refuses any bucket but the
derived `…-api-test` one, so `S3_BUCKET_TEST` must be set). `pnpm --filter @nibras/api s3:init`
(re)creates the development bucket `S3_BUCKET` (CORS is a no-op on MinIO, which allows every
origin); `-- --test` also creates the three test buckets.

### Environment variables and turbo

Turbo runs tasks in strict env mode: a task only sees the variables listed for it in `turbo.json`
(`globalEnv` or the task's `env`). Every variable a test or build reads must be added to
`turbo.json` **and** to the `env` block of `.github/workflows/ci.yml` (with a CI-safe value), and
documented in `.env.example`; otherwise it is silently missing in CI (and turbo's cache ignores it).

SP1 (auth, tenancy & RBAC) added `JWT_SECRET`, `TOTP_ENCRYPTION_KEY`, `EMAIL_FROM`, `SMTP_URL`,
`SMS_PROVIDER`, `HIBP_ENABLED`, `COOKIE_SECURE`, `RATE_LIMIT_USER` and `RATE_LIMIT_ANON` — all
have dev-only defaults in `.env.example`. Operations on this slice (first super-admin, secret
rotation, unlocking a locked account, reading dev OTPs, audit actions, tenant isolation) are in
[auth-and-tenancy.md](auth-and-tenancy.md).

### PWA: icons and service worker

- **Icons.** The source is `apps/web/public/icons/icon.svg` (the flame mark on `BRAND.themeColor`).
  After editing it, run `pnpm --filter @nibras/web icons` (sharp renders `icon-192.png`,
  `icon-512.png`, `maskable-512.png` and `apple-touch-icon.png`, deterministically) and commit the
  PNGs.
- **Service worker** (`apps/web/public/sw.js`, hand-written, no build step). It registers **only in
  production builds** (`next build` + `next start` or the standalone server); `next dev`
  unregisters any worker left in the browser, so dev never serves a stale shell. It caches only
  `/_next/static/` and the anonymous `/{fr,ar,en}/offline` pages; `/api/*`, HTML navigations and
  non-GET requests always go to the network. Bump `SW_VERSION` (`apps/web/src/lib/sw-version.ts`)
  when the offline page's copy or the cache layout changes: the new worker refetches the offline
  pages and deletes the previous version's caches. A new worker waits until the user clicks
  _Recharger_ in the update toast.
- **Testing it locally.** Build and start the web app, open DevTools > Application > Service
  workers, then tick _Offline_ and navigate: a page under `/ar/` shows the Arabic offline page.
  To start clean, _Unregister_ and clear the site data.

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`:

| Job             | Runner         | What it runs                                                                                                                              |
| --------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `check`         | ubuntu-latest  | lint, typecheck, `migrate:deploy` (nibras) + `db:migrate:test`, `pnpm test`, `pnpm build`, OpenAPI drift check                            |
| `windows-check` | windows-latest | lint, typecheck, tests of the DB-free packages (`@nibras/config`, `@nibras/contracts`, `@nibras/i18n`, `@nibras/ui`)                      |
| `migrate-check` | ubuntu-latest  | `pnpm --filter @nibras/db migrate:check` (schema vs migrations drift)                                                                     |
| `e2e`           | ubuntu-latest  | `pnpm build`, Playwright against the production build (see below); artefact `rtl-screens`                                                 |
| `images`        | ubuntu-latest  | `main` pushes only: builds, verifies (`verify-image.sh`), scans (trivy) and pushes `ghcr.io/<owner>/nibras-{web,api,worker}:{sha,latest}` |

The Linux jobs use Postgres 17, Redis 7 and Mailpit service containers; `init.sql` is applied with
`psql` after checkout. The Windows runner has no Docker services, so only packages that need neither
Postgres nor Redis run their tests there (a turbo `--filter`, not a skip flag); this keeps every
`package.json` script honest on Windows. When you add a DB-free package, add it to that filter.

### Security scans

`.github/workflows/security.yml` runs on every pull request, on pushes to `main` and weekly (Monday
06:00 UTC); the `images` job of `ci.yml` adds the image scan. Every job blocks except where noted.

| Job / step                | What blocks                                                                                        | Allow-list (always with a written reason)                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `audit`                   | `pnpm audit --prod --audit-level=high`; a second, non-blocking step reports moderate+ for all deps | `pnpm.auditConfig.ignoreGhsas` in `package.json` + a row in the table below      |
| `dependency-review` (PRs) | a pull request that adds or bumps a dependency with a high or critical advisory                    | fix the version; the action's `allow-ghsas` only with the same table row         |
| `codeql`                  | CodeQL default queries (javascript-typescript, no build) as code-scanning alerts                   | dismiss the alert in the Security tab with a reason (false positive / won't fix) |
| `gitleaks`                | any secret in the commits scanned (the PR's commits; the push range; full history weekly)          | `.gitleaks.toml`: dummy values only (`PLACEHOLDER_SECRETS`), path or exact value |
| `trivy-config`            | HIGH/CRITICAL misconfiguration in the Dockerfiles under `infra/`                                   | `.trivyignore` (the check ID from the report)                                    |
| `actionlint`              | workflow syntax, expression and `run:` shellcheck errors in `.github/workflows/*.yml`              | fix it (no allow-list)                                                           |
| `images` → trivy image    | a HIGH/CRITICAL vulnerability with a fix in an image, before it is pushed to GHCR                  | `.trivyignore` (CVE ID)                                                          |

A real secret is never allow-listed: rotate it first, then remove it from history. Every new
allow-list entry states why the finding does not apply and what removes it (an upgrade, a date).
The runtime images carry no package manager (`npm`, `npx`, `corepack`, `yarn` are deleted in
the `runner` stage): the base image's bundled npm is where trivy finds most HIGH advisories.

Accepted advisories today:

| Advisory                                    | Where                                                           | Why accepted                                                                                                                                           | Removed by       |
| ------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| GHSA-ggr8-5vv4-36mx / CVE-2026-40345 (high) | `deepmerge-ts` 7.1.5 via `@nibras/db > prisma > @prisma/config` | every prisma 6.19.x pins it, the fix needs Prisma 7; Prisma merges only its own config objects, never untrusted input (`ignoreGhsas` + `.trivyignore`) | Prisma 7 upgrade |

Run the same scanners locally before pushing (Docker; Git Bash on Windows needs
`MSYS_NO_PATHCONV=1` and `$(pwd -W)`). This is a pre-push check, not a replacement for CI:

```bash
pnpm audit --prod --audit-level=high
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.30.1 git /repo --config /repo/.gitleaks.toml --redact --no-banner
docker run --rm -v "$PWD:/repo" -w /repo aquasec/trivy:0.75.0 config --severity HIGH,CRITICAL --exit-code 1 --ignorefile .trivyignore infra
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12
```

gitleaks must report `no leaks found` (the full history takes a minute or two). Remove the images
afterwards (`docker rmi`) if disk is short.

## Container images

Dockerfiles live in `infra/docker/` (`web`, `api`, `worker`); the build context is the repo root
(the root `.dockerignore` keeps `.env*`, `node_modules` and build output out of it). Each is
multi-stage: `turbo prune --docker`, `pnpm install --frozen-lockfile`, `turbo run build`, then a
non-root runtime on `node:22-alpine` with a `HEALTHCHECK` on `/health/live`. The web image uses
Next.js `output: 'standalone'`.

```bash
docker build -f infra/docker/api.Dockerfile -t nibras-api .
docker build -f infra/docker/worker.Dockerfile -t nibras-worker .
docker build -f infra/docker/web.Dockerfile -t nibras-web .
```

The api and worker images carry production dependencies only (SP1.6 F11): after the build, the
builder reinstalls `node_modules` with `pnpm install --prod`, regenerates the Prisma client and
deletes sources, tests and tool configs (`tsconfig*`, `eslint.config.*`, `vitest.*`, `.turbo`). The
Prisma CLI is a runtime dependency of `@nibras/db` (`nibras-entrypoint migrate`); the api image sets
`CHECKPOINT_DISABLE=1` so it never writes an update-check cache in a read-only container.

Sizes (local build, `docker images` disk usage / `docker image inspect` size):

| Image  | Before SP1.6     | After SP1.6                                   |
| ------ | ---------------- | --------------------------------------------- |
| api    | 1.12 GB / 229 MB | 808 MB / 167 MB                               |
| worker | 1.04 GB / 224 MB | 665 MB / 150 MB                               |
| web    | 294 MB           | 300 MB / 70 MB (unchanged: standalone output) |

`infra/docker/verify-image.sh <image> <api|worker|web>` is the gate CI runs on each image before
pushing it to GHCR: uid 1001, no `typescript`/`vitest`/`eslint`/`@nestjs/cli`/`@swc/core` in any
`node_modules`, no `src/` under `apps/` or `packages/`, `@nibras/db`/`contracts`/`providers` resolve
from the app (api/worker), the Prisma CLI is present (api), `server.js` exists (web), and api/worker
stay under 600 MB (`docker image inspect` size). Run it locally after a build (Git Bash on Windows:
prefix with `MSYS_NO_PATHCONV=1`):

```bash
bash infra/docker/verify-image.sh nibras-api api
```

Each build adds roughly 700–800 MB (api, worker) or 300 MB (web) plus build cache to Docker's disk;
`docker rmi <image>` and `docker builder prune` reclaim it.

Running them against the local compose stack: `--network host` does not reach the Windows/macOS
host on Docker Desktop, so publish the port and point the env at `host.docker.internal`:

```bash
sed 's/localhost/host.docker.internal/g' .env | grep -v '^NODE_ENV' > .env.docker   # gitignored (.env.*)
docker run --rm --env-file .env.docker nibras-api migrate                # one-shot: prisma migrate deploy
docker run --rm -d --name nibras-api -p 3001:3001 --env-file .env.docker nibras-api
curl -fsS http://localhost:3001/health/live
docker run --rm -d --name nibras-worker -p 3002:3002 --env-file .env.docker nibras-worker
docker run --rm -d --name nibras-web -p 3000:3000 nibras-web
```

Add `--read-only --tmpfs /tmp --cap-drop ALL` to any of these `docker run` commands to reproduce the
staging hardening (`compose.staging.yml`); `migrate`, the api and the worker run unchanged that way.
The api image never migrates on boot: `migrate` is an explicit argument. Staging deployment is
described in [staging.md](staging.md).
