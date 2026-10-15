# Local development

How to run the platform on a developer machine (Windows 11 + Git Bash or PowerShell, macOS, Linux).
This page covers what SP0 (monorepo & infrastructure) delivers; later plans append to it.

## Prerequisites

- **Node.js 22 LTS**: the version is pinned in `.node-version` (fnm, nvm-windows, Volta and most
  version managers read it).
- **pnpm 10** via corepack: `corepack enable` once; the exact version is pinned by `packageManager`
  in the root `package.json`.
- **Docker Desktop** (with Docker Compose v2): runs Postgres, Redis, Mailpit and MinIO.

## First run

In this order:

```bash
pnpm install
cp .env.example .env   # PowerShell: Copy-Item .env.example .env
docker compose up -d   # Postgres, Redis, Mailpit, MinIO (init.sql creates roles and databases)
pnpm db:migrate        # migrate the dev database `tt`
pnpm db:migrate:test   # migrate the test databases tt_db_test, tt_api_test, tt_worker_test
pnpm dev               # docker compose up -d (no-op now), then turbo run dev
```

`pnpm dev` starts the infrastructure containers in the background, then every app in watch mode.
Stop the apps with `Ctrl+C`; stop the containers with `docker compose down`
(add `-v` to also drop the data volumes).

`init.sql` only runs on an empty Postgres volume. On a volume created before the per-package test
databases existed, `pnpm db:migrate:test` still works: Prisma creates a missing database
(`app_system` has `CREATEDB`). Re-run it after pulling new migrations, like `pnpm db:migrate`.

New migration (from `packages/db`'s schema), extra arguments go after `--`:

```bash
pnpm --filter @tt/db migrate:dev -- --name add_users --create-only
```

TypeScript configs extend the shared ones without the `.json` extension
(`"extends": "@tt/config/tsconfig/nest"`): `@tt/config`'s `exports` map `./tsconfig/*` to
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
| `pnpm db:migrate`      | Apply/create Prisma migrations (`@tt/db`)      |
| `pnpm db:migrate:test` | Apply migrations to the three test databases   |
| `pnpm db:generate`     | Regenerate the Prisma client (`@tt/db`)        |

Run a task for a single package with a filter, e.g. `pnpm --filter @tt/api test` or
`pnpm turbo run test --filter=@tt/api`.

Integration tests need the containers running (`docker compose up -d`) and migrated test databases
(`pnpm db:migrate:test`). They read `DATABASE_URL_TEST`, `DATABASE_URL_TEST_SYSTEM` and
`REDIS_URL_TEST` from the environment / `.env` as **bases**: turbo runs the packages' tests in
parallel, so each package's Vitest setup derives its own database and Redis index
(`packages/config/vitest/test-env.mjs`):

| Package      | Database         | Redis DB |
| ------------ | ---------------- | -------- |
| `@tt/db`     | `tt_db_test`     | 13       |
| `@tt/api`    | `tt_api_test`    | 14       |
| `@tt/worker` | `tt_worker_test` | 15       |

Within a package, spec files run one at a time (`fileParallelism: false`).

**Parallel worktrees.** Several git worktrees can share the one compose stack when each gets its own
test databases and Redis indexes. In the worktree's `.env` (a copy of the root one) set
`TEST_DB_PREFIX` (e.g. `tt_t1`: databases `tt_t1_db_test`, `tt_t1_api_test`, `tt_t1_worker_test`;
keep the `_test` suffix that `resetDatabase` requires, which the derivation appends) and
`TEST_REDIS_DB_BASE` (an integer 1..13; the packages use `base`, `base+1`, `base+2`, e.g. `10` for
the first worktree and `7` for the second, while the main checkout keeps the default `13`), then
run `pnpm db:migrate:test` in the worktree (Prisma creates the missing databases). Drop the
`<prefix>_*_test` databases when the worktree is removed.

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

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`:

| Job             | Runner         | What it runs                                                                                               |
| --------------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| `check`         | ubuntu-latest  | lint, typecheck, `migrate:deploy` (tt) + `db:migrate:test`, `pnpm test`, `pnpm build`, OpenAPI drift check |
| `windows-check` | windows-latest | lint, typecheck, tests of the DB-free packages (`@tt/config`, `@tt/contracts`, `@tt/i18n`, `@tt/ui`)       |
| `migrate-check` | ubuntu-latest  | `pnpm --filter @tt/db migrate:check` (schema vs migrations drift)                                          |
| `e2e`           | ubuntu-latest  | builds, starts api + worker, Playwright (`chromium` + `mobile`)                                            |
| `images`        | ubuntu-latest  | `main` pushes only: builds and pushes `ghcr.io/<owner>/tt-{web,api,worker}:{sha,latest}`                   |

The Linux jobs use Postgres 17, Redis 7 and Mailpit service containers; `init.sql` is applied with
`psql` after checkout. The Windows runner has no Docker services, so only packages that need neither
Postgres nor Redis run their tests there (a turbo `--filter`, not a skip flag); this keeps every
`package.json` script honest on Windows. When you add a DB-free package, add it to that filter.

## Container images

Dockerfiles live in `infra/docker/` (`web`, `api`, `worker`); the build context is the repo root
(the root `.dockerignore` keeps `.env*`, `node_modules` and build output out of it). Each is
multi-stage: `turbo prune --docker`, `pnpm install --frozen-lockfile`, `turbo run build`, then a
non-root runtime on `node:22-alpine` with a `HEALTHCHECK` on `/health/live`. The web image uses
Next.js `output: 'standalone'`.

```bash
docker build -f infra/docker/api.Dockerfile -t tt-api .
docker build -f infra/docker/worker.Dockerfile -t tt-worker .
docker build -f infra/docker/web.Dockerfile -t tt-web .
```

Each build adds roughly 1 GB (api, worker) or 300 MB (web) plus build cache to Docker's disk;
`docker builder prune` reclaims the cache.

Running them against the local compose stack: `--network host` does not reach the Windows/macOS
host on Docker Desktop, so publish the port and point the env at `host.docker.internal`:

```bash
sed 's/localhost/host.docker.internal/g' .env | grep -v '^NODE_ENV' > .env.docker   # gitignored (.env.*)
docker run --rm --env-file .env.docker tt-api migrate                # one-shot: prisma migrate deploy
docker run --rm -d --name tt-api -p 3001:3001 --env-file .env.docker tt-api
curl -fsS http://localhost:3001/health/live
docker run --rm -d --name tt-worker -p 3002:3002 --env-file .env.docker tt-worker
docker run --rm -d --name tt-web -p 3000:3000 tt-web
```

The api image never migrates on boot: `migrate` is an explicit argument. Staging deployment is
described in [staging.md](staging.md).
