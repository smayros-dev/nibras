# Nibras · نبراس

**Nibras** is an e-learning platform with live video sessions, built for independent teachers and
small schools in the Maghreb and France. One app to publish recorded courses, teach live, and
follow each student's progress. Students and their guardians see courses, sessions and progress in
the same place.

- Languages: **French** (default), **Arabic** (right-to-left) and **English**.
- Mobile-first and installable (PWA), tolerant of unstable networks.
- Multi-tenant from day one: an independent teacher gets a personal workspace; schools get an
  organisation with roles.
- Built for compliance: GDPR and the Tunisian INPDP rules, consent for minors, audit log.

The full product requirements are in [`PRD.md`](PRD.md) (French).

## Features

### Available now

**Accounts and security**

- Sign up, email verification, phone verification by SMS code, login, logout, password reset.
- Two-factor authentication (TOTP app + recovery codes), mandatory for organisation admins.
- Session management: list of devices, revoke a device, sessions refreshed silently in the
  background, login lockout after repeated failures, leaked-password check (HIBP, optional).
- Versioned consents (terms, privacy, code of conduct): the app is blocked until the latest
  version is accepted.
- Profile with language and timezone (with a banner when the browser timezone differs).

**Workspaces and roles**

- Personal workspace for independent teachers; organisations with members.
- Roles: owner, admin, teacher, assistant, guardian, student, with a permission matrix enforced by
  the API and by row-level security in PostgreSQL (tenant isolation tested on every route).
- Member management, ownership transfer, workspace suspension, audit log per workspace.
- Abuse reports, with a processing queue and email escalation to the platform admins.

**Platform administration**

- Super-admin console: users, workspaces, quotas, suspensions, abuse reports.
- `create-super-admin` command-line tool.

**Interface**

- Design system with light and dark themes, accessible components (Radix UI), 44 px touch
  targets.
- App shell with a sidebar on desktop and bottom navigation on mobile.
- Every screen in FR / AR / EN, with full right-to-left layout in Arabic.
- Installable PWA with an offline page, strict security headers (CSP with nonce, HSTS).

### Roadmap

Built in sub-projects (PRD §18), each with its own spec and plan in
[`docs/superpowers/`](docs/superpowers/):

| #     | Sub-project                                                           | Status      |
| ----- | --------------------------------------------------------------------- | ----------- |
| SP0   | Monorepo and infrastructure                                           | Done        |
| SP1   | Auth, tenancy and roles                                               | Done        |
| SP1.5 | Frontend redesign (Nibras brand, design system, PWA)                  | Done        |
| SP1.6 | Security hardening                                                    | In progress |
| SP2   | Students and invitations (email, links, CSV import, guardian consent) | Planning    |
| SP3   | Courses, content and media (video, PDF, resumable upload)             | To do       |
| SP4   | Progress and activity                                                 | To do       |
| SP5   | Scheduling and calendar                                               | To do       |
| SP6   | Live room and attendance (LiveKit)                                    | To do       |
| SP7   | Notifications and reminders                                           | To do       |
| SP8   | Messaging                                                             | To do       |
| SP9   | Session reports                                                       | To do       |
| SP10  | Dashboards and analytics                                              | To do       |
| SP11  | Compliance and MVP launch                                             | To do       |

## Stack

| Layer           | Technology                                                                  |
| --------------- | --------------------------------------------------------------------------- |
| Monorepo        | pnpm 10, Turborepo, TypeScript, Node.js 22                                  |
| Web             | Next.js 16 (App Router), next-intl, Tailwind CSS v4, Radix UI, PWA          |
| API             | NestJS, zod validation, OpenAPI, JWT in httpOnly cookies, argon2id, TOTP    |
| Background jobs | BullMQ worker on Redis                                                      |
| Database        | PostgreSQL 17 with Prisma 6 and row-level security per tenant               |
| Storage         | S3-compatible (MinIO locally)                                               |
| Email           | SMTP (Mailpit locally)                                                      |
| Video (planned) | LiveKit (live, WebRTC), managed VOD provider (recorded courses)             |
| Tests           | Vitest (unit and integration), Playwright (end-to-end), axe (accessibility) |
| CI/CD           | GitHub Actions, container images on GHCR, Docker Compose deployment         |

### Repository layout

```
apps/
  web/        Next.js web app and PWA (port 3000)
  api/        NestJS REST API (port 3001, /api/v1)
  worker/     BullMQ background jobs (port 3002)
packages/
  db/         Prisma schema, migrations, tenant extension, demo seed
  contracts/  zod schemas shared by api and web
  ui/         Design tokens and React components
  i18n/       FR / AR / EN messages
  providers/  Email and SMS providers and templates
  config/     Shared ESLint, TypeScript and Vitest config
infra/        Dockerfiles, staging compose, Postgres init
docs/         Runbooks, specs and implementation plans
```

## Run it locally

### Prerequisites

- **Node.js 22.18+** and **pnpm 10** (`corepack enable`).
- **Docker Desktop** (or Rancher Desktop) with Compose v2. Ports 3000–3002, 5432, 6379, 1025,
  8025, 9000 and 9001 must be free.

### First run

```bash
pnpm install
cp .env.example .env    # PowerShell: Copy-Item .env.example .env
docker compose up -d    # Postgres, Redis, Mailpit, MinIO
pnpm db:migrate         # dev database
pnpm db:migrate:test    # test databases
pnpm db:seed            # demo accounts (local database only)
pnpm dev                # web, api and worker in watch mode
```

Then open:

| What                               | URL                          |
| ---------------------------------- | ---------------------------- |
| Web app                            | http://localhost:3000        |
| API                                | http://localhost:3001/api/v1 |
| Mailpit (every email sent locally) | http://localhost:8025        |
| MinIO console                      | http://localhost:9001        |

### Demo accounts

After `pnpm db:seed`, every account uses the password **`mot-de-passe-demo-2026`**. They belong to
the demo organisation _Académie El Manar_:

| Email                  | Role                                       |
| ---------------------- | ------------------------------------------ |
| `amine@example.test`   | Owner (asked to set up 2FA at first login) |
| `leila@example.test`   | Teacher                                    |
| `karim@example.test`   | Teacher                                    |
| `sana@example.test`    | Assistant (Arabic interface)               |
| `rajaa@example.test`   | Guardian                                   |
| `yassine@example.test` | Student (minor)                            |
| `noussa@example.test`  | Student                                    |
| `tarek@example.test`   | Student (suspended, no guardian consent)   |

You can also create your own account from the sign-up page: the verification email arrives in
Mailpit. For the super-admin console, create an account with
`pnpm --filter @nibras/api cli create-super-admin` (see
[`docs/runbooks/auth-and-tenancy.md`](docs/runbooks/auth-and-tenancy.md)).

### Tests

```bash
pnpm lint            # ESLint
pnpm typecheck       # TypeScript
pnpm test            # unit and integration tests (Docker stack must be running)
pnpm format:check    # Prettier
pnpm --filter @nibras/web e2e    # Playwright end-to-end tests, FR and AR, desktop and mobile
```

Run one package with a filter, for example `pnpm --filter @nibras/api test`. Details (production
mode for end-to-end tests, test databases, parallel worktrees) are in
[`docs/runbooks/local-dev.md`](docs/runbooks/local-dev.md).

To stop: `Ctrl+C` for the apps, `docker compose down` for the containers (add `-v` to delete the
local data).

## Deployment

Nibras ships as three container images (`nibras-web`, `nibras-api`, `nibras-worker`) plus
PostgreSQL, Redis and S3-compatible storage. Only the web container is exposed: the browser
reaches the API through the web app's `/api/*` proxy.

### Pipeline

1. A push to `main` runs CI (`.github/workflows/ci.yml`): lint, typecheck, tests on Linux and
   Windows, migration check, end-to-end tests. When everything passes, the images are built and
   pushed to GitHub Container Registry (`ghcr.io/<owner>/nibras-*`).
2. The staging deployment (`.github/workflows/deploy-staging.yml`) then copies
   `infra/compose.staging.yml` to the server over SSH, pulls the images and restarts them. A
   one-shot `migrate` service applies database migrations before the API starts.

The deployment is off until the repository variable `STAGING_DEPLOY_ENABLED` is `true` and the SSH
secrets are set.

### Server setup

The recommended target is a Linux VM at **OVHcloud** in the EU (Paris / Gravelines), for example
2 vCPU, 4 GB RAM, 40 GB disk:

1. Install Docker Engine 24+ with the Compose plugin and create a `deploy` user in the `docker`
   group.
2. Put a TLS reverse proxy (Caddy, nginx or Traefik) in front of `127.0.0.1:3000`. Do not publish
   the Postgres, Redis or MinIO ports.
3. Write `/opt/nibras/infra/.env.staging` (mode `600`) from `.env.example`, with fresh random
   secrets; never reuse the example values.
4. In GitHub (Settings › Secrets and variables › Actions), set `STAGING_SSH_HOST`,
   `STAGING_SSH_USER`, `STAGING_SSH_KEY`, `GHCR_READ_USER`, `GHCR_READ_TOKEN` and the variable
   `STAGING_DEPLOY_ENABLED=true`.
5. Push to `main`: CI builds the images and the deployment runs.

For production, the same images can run against managed PostgreSQL and Redis and OVHcloud Object
Storage (S3), with LiveKit Cloud for live video once SP6 lands.

The complete procedure (environment file, first run, manual migrations, rollback, health checks)
is in [`docs/runbooks/staging.md`](docs/runbooks/staging.md).

## Documentation

| Document                                                                 | Content                                  |
| ------------------------------------------------------------------------ | ---------------------------------------- |
| [`PRD.md`](PRD.md)                                                       | Product requirements (French)            |
| [`docs/runbooks/local-dev.md`](docs/runbooks/local-dev.md)               | Local development and tests              |
| [`docs/runbooks/staging.md`](docs/runbooks/staging.md)                   | Deployment                               |
| [`docs/runbooks/auth-and-tenancy.md`](docs/runbooks/auth-and-tenancy.md) | Auth, tenancy and super-admin operations |
| [`docs/runbooks/frontend.md`](docs/runbooks/frontend.md)                 | Frontend conventions, design system, PWA |
| [`docs/superpowers/`](docs/superpowers/)                                 | Design specs and implementation plans    |
