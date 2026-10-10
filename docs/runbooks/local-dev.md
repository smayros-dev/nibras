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

```bash
pnpm install
cp .env.example .env   # PowerShell: Copy-Item .env.example .env
pnpm dev               # docker compose up -d, then turbo run dev
```

`pnpm dev` starts the infrastructure containers in the background, then every app in watch mode.
Stop the apps with `Ctrl+C`; stop the containers with `docker compose down`
(add `-v` to also drop the data volumes).

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

| Command            | What it does                                   |
| ------------------ | ---------------------------------------------- |
| `pnpm lint`        | ESLint in every package (`turbo run lint`)     |
| `pnpm typecheck`   | `tsc --noEmit` in every package                |
| `pnpm test`        | Vitest unit/integration tests in every package |
| `pnpm e2e`         | Playwright end-to-end tests                    |
| `pnpm build`       | Production build of every package              |
| `pnpm format`      | Prettier write (`pnpm format:check` to verify) |
| `pnpm db:migrate`  | Apply/create Prisma migrations (`@tt/db`)      |
| `pnpm db:generate` | Regenerate the Prisma client (`@tt/db`)        |

Run a task for a single package with a filter, e.g. `pnpm --filter @tt/api test` or
`pnpm turbo run test --filter=@tt/api`.

Integration tests need the containers running (`docker compose up -d`) and read `DATABASE_URL`,
`DATABASE_URL_SYSTEM` and `REDIS_URL` from the environment / `.env`.
