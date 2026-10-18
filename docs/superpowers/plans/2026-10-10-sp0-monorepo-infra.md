# SP0 — Monorepo & Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use **superpowers:subagent-driven-development** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Model policy (owner decision, overrides the skill's default tiers):** every implementer, task reviewer, re-reviewer and fixer subagent runs on **Opus** (`model: "opus"`). Changes to this plan, the spec or the architecture go back to **Fable** (`model: "fable"`). Always pass the model explicitly when dispatching.

**Goal:** A pnpm + Turborepo monorepo where `pnpm dev` starts Postgres/Redis/Mailpit/MinIO plus the web, API and worker apps, CI is green, a "hello" page renders in FR/AR(RTL)/EN, all three apps answer `/health`, and an empty Prisma schema is migrated with the two database roles the tenant-isolation design needs.

**Architecture:** Three apps (`apps/web` Next.js App Router, `apps/api` NestJS REST, `apps/worker` NestJS standalone BullMQ) over six packages (`db`, `contracts`, `i18n`, `ui`, `config`, `providers` — the last one is created in SP1). Packages build to `dist/` with tsup and are consumed through `exports`; Turborepo orders `build`/`dev`. Local services run in Docker Compose; CI (GitHub Actions) runs lint/typecheck/test/build/migration check on Linux and a unit-only job on Windows, then builds the three container images.

**Tech Stack (pin these majors; use the latest stable patch of each):** Node 22 LTS · pnpm 10 · Turborepo 2 · TypeScript 5 · ESLint 9 (flat config) + typescript-eslint 8 · Prettier 3 · tsup 8 · Next.js 16 + React 19 · next-intl 4 · Tailwind CSS 4 · NestJS 11 · zod 4 · nestjs-zod (latest major supporting zod 4) · @nestjs/swagger 11 · @nestjs/terminus 11 · nestjs-pino 4 + pino 9 · prom-client 15 · @opentelemetry/sdk-node (latest 0.x) · Prisma 6 · BullMQ 5 · ioredis 5 · Vitest 3 + unplugin-swc + @swc/core · supertest 7 · Playwright 1.x · openapi-typescript 7 + openapi-fetch 0.x · PostgreSQL 17 · Redis 7 · Mailpit (`axllent/mailpit`) · MinIO (`minio/minio`).

**Spec:** `docs/superpowers/specs/2026-10-10-plateforme-cours-design.md` (entry point) → `PRD.md` v2.1 (authoritative). This plan implements PRD §18 sub-project **0** and the parts of §13 (architecture), §14.3 (health checks), §14.7 (secrets, transport), §14.9 (observability), §14.11 (CI), §8.16.1 (i18n) and D-P16 it depends on.

## Global Constraints

- Developer OS is Windows 11; every `package.json` script must run from Git Bash **and** from PowerShell: no bash-only syntax in scripts (`&&` is fine — npm runs scripts through cmd/sh; `VAR=x cmd` is not — use `cross-env`), forward slashes only, no symlinks.
- Monorepo layout is fixed by PRD §13.2: `apps/web`, `apps/api`, `apps/worker`, `packages/db`, `packages/contracts`, `packages/providers`, `packages/ui`, `packages/i18n`, `packages/config`. Package names: `@nibras/web`, `@nibras/api`, `@nibras/worker`, `@nibras/db`, `@nibras/contracts`, `@nibras/providers`, `@nibras/ui`, `@nibras/i18n`, `@nibras/config`.
- Locales: `fr` (default), `ar` (RTL), `en`. Detection order (PRD §8.16.1): user preference > workspace setting > `Accept-Language` (only the last applies in SP0). `dir="rtl"` on `<html>` for `ar`; CSS logical properties only (`margin-inline-start`, never `margin-left`); Western digits 0-9 in Arabic (D-P16: `ar-TN-u-nu-latn`); Gregorian calendar; fonts with Arabic support (IBM Plex Sans Arabic or Noto Sans Arabic).
- API conventions (PRD §12): REST under `/api/v1`; error body is exactly `{ code, message, details?, requestId }` with stable upper-snake codes; validation with zod on every input; OpenAPI generated from NestJS and shared with the front through `packages/contracts`.
- Ports: web 3000, api 3001, worker 3002, Postgres 5432, Redis 6379, Mailpit SMTP 1025 / UI 8025, MinIO 9000 / console 9001.
- Database roles (PRD §13.3): the API connects as `app_user` (**no** `BYPASSRLS`); migrations, worker and tests' reset helper use `app_system` (`BYPASSRLS`, owner of all tables, `CREATEDB` for Prisma's shadow DB). Prisma models are PascalCase with camelCase fields mapped to snake_case columns (`@map`) and snake_case table names (`@@map`); ids are `uuid(7)`; every table has `createdAt`/`updatedAt` `timestamptz`.
- Health endpoints on all three apps: `/health/live` (process up) and `/health/ready` (dependencies reachable, 503 otherwise). The API exposes them **outside** the `/api/v1` prefix.
- Logs are structured JSON (pino) carrying `request_id`; emails are never logged in clear (redact `email`, `password`, `authorization`, `cookie`).
- No secret in the repo: `.env.example` only; `.env` is gitignored; CI reads GitHub secrets; staging reads an env file on the host.
- Commits: Conventional Commits (`feat:`, `chore:`, `test:`, `ci:`), one commit per task minimum.

## Review Focus

Five failure modes the spec implies but no acceptance criterion exercises; each has its test added to the owning task below.

1. **Accept-Language negotiation** — a browser sending `ar-TN,fr;q=0.8` must land on `/ar`, `fr-FR` on `/fr`, and an unsupported `de-DE` on the default `/fr`; a regional subtag must not fall through to the default. → Task 7.
2. **Untranslated key rendered as raw text** — a key present in `fr.json` but missing in `ar.json` must fail a test, not ship as `nav.dashboard` on screen (AC-I18N-01). → Task 6.
3. **Readiness that lies** — `/health/ready` must return 503 (not 200, not a hang) when Postgres or Redis is unreachable, so an orchestrator does not route traffic to a dead instance. → Task 4.
4. **Error envelope leaking internals** — an unexpected exception must produce `500 { code: "INTERNAL_ERROR", requestId }` with no stack or SQL in the body; a zod failure must be `422 VALIDATION_FAILED` with field paths in `details`. → Task 4.
5. **Scripts that only work on Linux** — CI must run lint/typecheck/unit tests on `windows-latest` too, so a bash-ism in a script is caught before the developer hits it. → Task 9.

---

## File Structure

```
.gitignore .editorconfig .prettierrc .prettierignore .npmrc .node-version
package.json pnpm-workspace.yaml turbo.json
.env.example docker-compose.yml
infra/docker/postgres/init.sql           roles app_user/app_system, DBs tt + tt_test
infra/docker/{web,api,worker}.Dockerfile  multi-stage, turbo prune
infra/compose.staging.yml                 images from GHCR + env file
.github/workflows/ci.yml                  check (linux) · windows-check · migrate-check · e2e · images
.github/workflows/deploy-staging.yml      ssh pull+up, skipped when secrets absent
docs/runbooks/local-dev.md docs/runbooks/staging.md

packages/config/                          shared tooling only, no runtime code
  package.json tsconfig/base.json tsconfig/nest.json tsconfig/next.json tsconfig/package.json
  eslint/base.mjs eslint/nest.mjs eslint/next.mjs  vitest/base.ts  tailwind/preset.ts
packages/contracts/src/{index,error-codes,errors,locale,queues}.ts
packages/contracts/openapi/openapi.json   generated by `pnpm --filter @nibras/api openapi:export`
packages/contracts/src/generated/api.d.ts generated by openapi-typescript (committed)
packages/db/prisma/schema.prisma  prisma/migrations/  src/{index,client,testing}.ts
packages/i18n/messages/{fr,ar,en}.json  src/{index,locales,format}.ts  src/locales.test.ts
packages/ui/src/{index,button,app-shell,styles.css}.ts(x)  src/button.test.tsx

apps/api/src/main.ts app.module.ts
apps/api/src/config/env.ts                zod-validated process.env
apps/api/src/common/{api-error,http-exception.filter,request-id.middleware,request-context}.ts
apps/api/src/health/{health.module,health.controller}.ts
apps/api/src/observability/{logger.module,metrics.controller,tracing}.ts
apps/api/src/openapi/export.ts
apps/api/test/helpers/app.ts              createTestApp()
apps/api/test/health.e2e-spec.ts apps/api/test/errors.e2e-spec.ts
apps/api/vitest.config.ts

apps/worker/src/{main,env,health-server,queues}.ts  src/processors/ping.processor.ts
apps/worker/test/ping.e2e-spec.ts

apps/web/src/proxy.ts                     (Next 16 name for middleware) locale negotiation
apps/web/src/i18n/{routing,request}.ts
apps/web/src/app/[locale]/{layout,page}.tsx  src/app/health/route.ts
apps/web/src/lib/api.ts                   openapi-fetch client through the /api rewrite
apps/web/e2e/hello.spec.ts apps/web/playwright.config.ts
```

---

### Task 1: Repository init, root workspace and shared tooling config

**Files:**
- Create: `.gitignore`, `.editorconfig`, `.prettierrc`, `.prettierignore`, `.npmrc`, `.node-version`, `package.json`, `pnpm-workspace.yaml`, `turbo.json`
- Create: `packages/config/package.json`, `packages/config/tsconfig/{base,nest,next,package}.json`, `packages/config/eslint/{base,nest,next}.mjs`, `packages/config/vitest/base.ts`, `packages/config/tailwind/preset.ts`
- Create: `docs/runbooks/local-dev.md`

**Interfaces:**
- Produces: workspace globs `apps/*`, `packages/*`; turbo tasks `build`, `dev` (persistent, cache false), `lint`, `typecheck`, `test`, `e2e`, `openapi:export`; root scripts `dev`, `build`, `lint`, `typecheck`, `test`, `e2e`, `format`, `db:migrate`, `db:generate`; tsconfig bases every package extends; `@nibras/config/eslint/{base,nest,next}` exports; `@nibras/config/vitest/base` exporting `baseVitestConfig`.

- [ ] **Step 1: Initialise git and commit the existing docs**

Run: `git init -b main` then create `.gitignore` containing at least: `node_modules/`, `.superpowers/`, `.env`, `.env.*`, `!.env.example`, `.turbo/`, `dist/`, `.next/`, `coverage/`, `playwright-report/`, `test-results/`, `*.log`, `.DS_Store`, `Thumbs.db`, `*.tsbuildinfo`, `apps/web/e2e/.auth/`.
Run: `git add .gitignore CLAUDE.md PRD.md docs && git commit -m "docs: import PRD v2.1, design summary and plans"`
Expected: one commit on `main`, `git status` clean.

- [ ] **Step 2: Write the root workspace files**

`package.json`: `"private": true`, `"packageManager": "pnpm@10.<latest>"`, `"engines": { "node": ">=22 <23" }`, scripts: `"dev": "docker compose up -d && turbo run dev"`, `"build": "turbo run build"`, `"lint": "turbo run lint"`, `"typecheck": "turbo run typecheck"`, `"test": "turbo run test"`, `"e2e": "turbo run e2e"`, `"format": "prettier --write ."`, `"format:check": "prettier --check ."`, `"db:migrate": "pnpm --filter @nibras/db migrate:dev"`, `"db:generate": "pnpm --filter @nibras/db generate"`; devDependencies `turbo`, `prettier`, `cross-env`.
`pnpm-workspace.yaml`: `packages: ["apps/*", "packages/*"]`.
`.npmrc`: `auto-install-peers=true`, `strict-peer-dependencies=false`.
`.node-version`: `22`.
`turbo.json`: `build` (`dependsOn: ["^build"]`, `outputs: ["dist/**", ".next/**", "!.next/cache/**"]`), `dev` (`dependsOn: ["^build"]`, `cache: false`, `persistent: true`), `lint`, `typecheck` (`dependsOn: ["^build"]`), `test` (`dependsOn: ["^build"]`, `env: ["DATABASE_URL", "DATABASE_URL_SYSTEM", "REDIS_URL"]`), `e2e` (`cache: false`), `openapi:export` (`dependsOn: ["build"]`); `globalEnv: ["NODE_ENV"]`; `globalDependencies: [".env.example"]`.
`.editorconfig`: UTF-8, LF, 2 spaces. `.prettierrc`: `{ "singleQuote": true, "semi": true, "printWidth": 100, "endOfLine": "lf" }`.

- [ ] **Step 3: Write `packages/config`**

`package.json` name `@nibras/config`, `"exports": { "./tsconfig/*": "./tsconfig/*.json", "./eslint/*": "./eslint/*.mjs", "./vitest/base": "./vitest/base.ts", "./tailwind/preset": "./tailwind/preset.ts" }`, devDependencies for eslint 9, typescript-eslint 8, `eslint-config-prettier`, `@next/eslint-plugin-next`, vitest 3.
`tsconfig/base.json`: `strict: true`, `target: ES2022`, `module: NodeNext` / `moduleResolution: NodeNext`, `skipLibCheck`, `isolatedModules`, `verbatimModuleSyntax: false` (NestJS decorators need `emitDecoratorMetadata: true`, `experimentalDecorators: true` → put those in `tsconfig/nest.json`), `tsconfig/next.json` (`jsx: preserve`, `module: ESNext`, `moduleResolution: Bundler`, next plugin), `tsconfig/package.json` (library build, `declaration: true`).
`eslint/base.mjs`: typescript-eslint recommended + prettier; `eslint/nest.mjs` adds decorator-friendly rules; `eslint/next.mjs` adds `@next/eslint-plugin-next` core-web-vitals.
`vitest/base.ts`: `export const baseVitestConfig = { test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], passWithNoTests: true } }`.
`tailwind/preset.ts`: Tailwind 4 preset exporting font family `sans: ['IBM Plex Sans Arabic', 'IBM Plex Sans', 'system-ui']` and the colour tokens the builder chooses.

- [ ] **Step 4: Write `docs/runbooks/local-dev.md`**

Prerequisites (Node 22 via `.node-version`, pnpm 10 via corepack, Docker Desktop), `pnpm install`, `cp .env.example .env`, `pnpm dev`, ports table from Global Constraints, Mailpit UI URL, MinIO console URL, how to run tests. Keep it to what SP0 delivers; later plans append.

- [ ] **Step 5: Verify the workspace resolves**

Run: `pnpm install && pnpm turbo run lint typecheck test build`
Expected: completes with "No tasks were executed" style output or zero packages (there are none yet), exit code 0, `pnpm-lock.yaml` created.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: bootstrap pnpm + turborepo workspace and shared config"
```

---

### Task 2: Docker Compose dev stack, env template and `packages/db` with an empty migrated schema

**Files:**
- Create: `docker-compose.yml`, `infra/docker/postgres/init.sql`, `.env.example`
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/<ts>_init/migration.sql`, `packages/db/src/index.ts`, `packages/db/src/client.ts`, `packages/db/src/testing.ts`, `packages/db/vitest.config.ts`
- Test: `packages/db/src/client.test.ts`

**Interfaces:**
- Produces (`@nibras/db`): `createPrismaClient(url?: string): PrismaClient` (default `process.env.DATABASE_URL`); `systemPrisma(): PrismaClient` (singleton on `DATABASE_URL_SYSTEM`); `resetDatabase(client = systemPrisma()): Promise<void>` — truncates every table in `public` except `_prisma_migrations` with `RESTART IDENTITY CASCADE`; re-exports `Prisma`, `PrismaClient` and generated types. Scripts: `generate`, `migrate:dev` (`prisma migrate dev`), `migrate:deploy`, `migrate:check` (`prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url $DATABASE_URL_SYSTEM --exit-code`), `studio`. Env: `DATABASE_URL=postgresql://app_user:app@localhost:5432/tt`, `DATABASE_URL_SYSTEM=postgresql://app_system:app@localhost:5432/tt`, `DATABASE_URL_TEST=postgresql://app_user:app@localhost:5432/tt_test`, `DATABASE_URL_TEST_SYSTEM=postgresql://app_system:app@localhost:5432/tt_test`.

- [ ] **Step 1: Write the failing client test**

```ts
// packages/db/src/client.test.ts
import { describe, it, expect } from 'vitest';
import { createPrismaClient, systemPrisma, resetDatabase } from './index';

describe.skipIf(!process.env.DATABASE_URL_TEST)('db client', () => {
  it('connects as app_user without BYPASSRLS', async () => {
    const db = createPrismaClient(process.env.DATABASE_URL_TEST);
    const [row] = await db.$queryRaw<{ rolbypassrls: boolean; rolname: string }[]>`
      SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(row).toEqual({ rolname: 'app_user', rolbypassrls: false });
  });
  it('system role bypasses RLS and migrations table exists', async () => {
    const [{ rolbypassrls }] = await systemPrisma().$queryRaw<{ rolbypassrls: boolean }[]>`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(rolbypassrls).toBe(true);
    const [{ count }] = await systemPrisma().$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    expect(Number(count)).toBeGreaterThanOrEqual(1);
  });
  it('resetDatabase leaves _prisma_migrations intact', async () => {
    await resetDatabase();
    const [{ count }] = await systemPrisma().$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint FROM _prisma_migrations`;
    expect(Number(count)).toBeGreaterThanOrEqual(1);
  });
});
```

The test uses `DATABASE_URL_TEST*`; `packages/db/vitest.config.ts` maps `DATABASE_URL_TEST_SYSTEM` into `process.env.DATABASE_URL_SYSTEM` in `setupFiles` so `systemPrisma()` hits `tt_test`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @nibras/db test`
Expected: FAIL — cannot resolve `./index` / connection refused.

- [ ] **Step 3: Write the Compose stack and init script**

`docker-compose.yml` services: `postgres` (`postgres:17-alpine`, `POSTGRES_PASSWORD=postgres`, volume `./infra/docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql`, port 5432, healthcheck `pg_isready`), `redis` (`redis:7-alpine`, 6379, healthcheck `redis-cli ping`), `mailpit` (`axllent/mailpit`, 1025/8025), `minio` (`minio/minio`, `server /data --console-address ":9001"`, 9000/9001, `MINIO_ROOT_USER=minioadmin`, `MINIO_ROOT_PASSWORD=minioadmin`, volume). Named volumes for postgres and minio.
`init.sql`: `CREATE ROLE app_system LOGIN PASSWORD 'app' BYPASSRLS CREATEDB; CREATE ROLE app_user LOGIN PASSWORD 'app' NOBYPASSRLS;` then for each of `tt` and `tt_test`: `CREATE DATABASE <db> OWNER app_system;` and, connected to it (`\c <db>`): `CREATE EXTENSION IF NOT EXISTS citext; GRANT USAGE ON SCHEMA public TO app_user; ALTER DEFAULT PRIVILEGES FOR ROLE app_system IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user; ALTER DEFAULT PRIVILEGES FOR ROLE app_system IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;` (SP1 revokes UPDATE/DELETE on `audit_log` in its own migration).
`.env.example`: the four `DATABASE_URL*` values, `REDIS_URL=redis://localhost:6379`, `NODE_ENV=development`, `PORT=3001`, `WORKER_PORT=3002`, `WEB_ORIGIN=http://localhost:3000`, `API_URL=http://localhost:3001`, `LOG_LEVEL=debug`, `OTEL_EXPORTER_OTLP_ENDPOINT=` (empty = tracing off), `SMTP_URL=smtp://localhost:1025`, `S3_ENDPOINT=http://localhost:9000`, `S3_ACCESS_KEY=minioadmin`, `S3_SECRET_KEY=minioadmin`, `S3_BUCKET=tt-dev`.

- [ ] **Step 4: Write `packages/db` with the empty schema and the init migration**

`schema.prisma`: `generator client { provider = "prisma-client-js" }`, `datasource db { provider = "postgresql", url = env("DATABASE_URL_SYSTEM") }` (migrations always run as the owner role), `previewFeatures` none; **no models yet** — the init migration only contains `CREATE EXTENSION IF NOT EXISTS citext;` (idempotent with init.sql) so SP1's first model migration has a predecessor. Create it with `prisma migrate dev --name init --create-only`, paste the SQL, then `prisma migrate dev`.
`src/client.ts`: `createPrismaClient(url?)` with `datasources: { db: { url } }` and pino-friendly `log` config; `systemPrisma()` singleton.
`src/testing.ts`: `resetDatabase()` — query `pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`, then one `TRUNCATE ... RESTART IDENTITY CASCADE`.
`package.json`: name `@nibras/db`, `exports` → `dist/index.js` + `dist/index.d.ts`, `build: tsup src/index.ts --format esm,cjs --dts`, `dev: tsup --watch`, the migration scripts above, `vitest.config.ts` extending `baseVitestConfig`.

- [ ] **Step 5: Run the stack, migrate, run the test**

Run: `docker compose up -d && cp .env.example .env && pnpm --filter @nibras/db generate && pnpm --filter @nibras/db migrate:dev` then `cross-env DATABASE_URL_SYSTEM=<tt_test system url> pnpm --filter @nibras/db exec prisma migrate deploy` (apply to the test DB), then `pnpm --filter @nibras/db test`
Expected: migration applied in both DBs; 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml infra .env.example packages/db && git commit -m "feat(db): docker compose dev stack, db roles and empty prisma schema"
```

---

### Task 3: `packages/contracts` — error codes, error envelope, locale and queue constants

**Files:**
- Create: `packages/contracts/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/error-codes.ts`, `src/errors.ts`, `src/locale.ts`, `src/queues.ts`
- Test: `packages/contracts/src/errors.test.ts`

**Interfaces:**
- Produces (`@nibras/contracts`):
  - `ERROR_CODES` as const tuple and `type ErrorCode`. SP0 set: `VALIDATION_FAILED`, `NOT_FOUND`, `UNAUTHENTICATED`, `PERMISSION_DENIED`, `RATE_LIMITED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`. (SP1 appends to this tuple.)
  - `ApiErrorBodySchema = z.object({ code: z.enum(ERROR_CODES), message: z.string(), details: z.unknown().optional(), requestId: z.string() })` and `type ApiErrorBody`.
  - `LOCALES = ['fr', 'ar', 'en'] as const`, `type Locale`, `DEFAULT_LOCALE: Locale = 'fr'`, `LocaleSchema = z.enum(LOCALES)`, `isRtl(locale): boolean` (true only for `ar`), `dirOf(locale): 'rtl' | 'ltr'`, `intlTag(locale): string` → `fr-FR`, `ar-TN-u-nu-latn`, `en-GB`.
  - `QUEUES = { sessions: 'sessions', notifications: 'notifications', media: 'media', imports: 'imports', compliance: 'compliance', analytics: 'analytics' } as const` (PRD §13.5) and `type QueueName`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/contracts/src/errors.test.ts
import { ApiErrorBodySchema, intlTag, dirOf, DEFAULT_LOCALE, QUEUES } from './index';
it('accepts a well-formed error body and rejects unknown codes', () => {
  expect(ApiErrorBodySchema.safeParse({ code: 'NOT_FOUND', message: 'x', requestId: 'r1' }).success).toBe(true);
  expect(ApiErrorBodySchema.safeParse({ code: 'NOPE', message: 'x', requestId: 'r1' }).success).toBe(false);
});
it('maps locales to Intl tags with western digits for Arabic', () => {
  expect(intlTag('ar')).toBe('ar-TN-u-nu-latn');
  expect(new Intl.NumberFormat(intlTag('ar')).format(1234)).toBe('1,234');
  expect(dirOf('ar')).toBe('rtl'); expect(dirOf('fr')).toBe('ltr'); expect(DEFAULT_LOCALE).toBe('fr');
});
it('exposes the six PRD queues', () => { expect(Object.values(QUEUES)).toHaveLength(6); });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @nibras/contracts test` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement the four source files and the package manifest**

Same build/export shape as `@nibras/db` (tsup esm+cjs+dts). zod 4 as a dependency. `intlTag('ar')` number formatting: the `1,234` assertion documents the Intl output for `ar-TN-u-nu-latn` in Node 22's ICU; if the grouping separator differs on the implementer's ICU, assert `/^[0-9][,. ]?[0-9]{3}$/` instead and keep the digit check.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @nibras/contracts test` — Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts && git commit -m "feat(contracts): error envelope, locale helpers and queue names"
```

---

### Task 4: `apps/api` — NestJS bootstrap, env validation, error envelope, request id, health

**Files:**
- Create: `apps/api/package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `vitest.config.ts`, `eslint.config.mjs`
- Create: `apps/api/src/main.ts`, `src/app.module.ts`, `src/config/env.ts`, `src/common/api-error.ts`, `src/common/http-exception.filter.ts`, `src/common/request-id.middleware.ts`, `src/common/request-context.ts`, `src/common/zod-validation.pipe.ts`, `src/health/health.module.ts`, `src/health/health.controller.ts`, `src/redis/redis.module.ts`
- Create: `apps/api/test/helpers/app.ts`
- Test: `apps/api/test/health.e2e-spec.ts`, `apps/api/test/errors.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `env` — `EnvSchema.parse(process.env)` with `NODE_ENV`, `PORT` (default 3001), `DATABASE_URL`, `DATABASE_URL_SYSTEM`, `REDIS_URL`, `WEB_ORIGIN`, `LOG_LEVEL`, `OTEL_EXPORTER_OTLP_ENDPOINT?`; startup throws on invalid env.
  - `class ApiError extends HttpException { constructor(status: number, code: ErrorCode, message: string, details?: unknown) }` — the only way to raise domain errors.
  - `HttpExceptionFilter` (global): any `ApiError` → its status + envelope; `ZodValidationException`/`BadRequestException` from validation → `422 VALIDATION_FAILED` with `details: { issues: [{ path, message }] }`; `NotFoundException` → `404 NOT_FOUND`; everything else → `500 INTERNAL_ERROR`, `message: "Internal error"`, logged at error level with stack; every envelope carries `requestId`.
  - `RequestIdMiddleware`: reuses incoming `X-Request-Id` (≤ 128 chars) else `crypto.randomUUID()`; sets response header `X-Request-Id`; stores in `RequestContext`.
  - `RequestContext` — `AsyncLocalStorage<{ requestId: string; ip: string; userAgent: string }>` with `RequestContext.get()` / `RequestContext.run(store, fn)`; SP1 extends the store type with `user`, `session`, `workspace`, `membership`.
  - `ZodValidationPipe` (global) — nestjs-zod's pipe; DTOs are `createZodDto(schema)` classes so `@nestjs/swagger` can document them.
  - `RedisModule` exporting `REDIS` token (an `ioredis` client on `REDIS_URL`).
  - Health: `GET /health/live` → `200 { status: 'ok' }`; `GET /health/ready` → Terminus check `db` (`SELECT 1` on `app_user` client) + `redis` (`PING`), 503 when any fails.
  - `createTestApp(opts?: { overrides?: (b: TestingModuleBuilder) => TestingModuleBuilder }): Promise<{ app: INestApplication; http: TestAgent }>` — builds `AppModule` with the global pipe/filter/middleware exactly as `main.ts`, listens on an ephemeral port, returns a supertest agent; `app.close()` tears down. Test env loads `.env` and overrides `DATABASE_URL`/`DATABASE_URL_SYSTEM` with the `_TEST` variants.
  - `main.ts`: `app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready', 'metrics'] })`, `helmet` with `frameAncestors: ["'none'"]`, CORS allowing only `WEB_ORIGIN` with credentials, `app.set('trust proxy', 1)`, cookie-parser.

- [ ] **Step 1: Write the failing health and error tests**

```ts
// apps/api/test/health.e2e-spec.ts
describe('health', () => {
  it('live is 200 and ready is 200 with db+redis up', async () => {
    const { app, http } = await createTestApp();
    await http.get('/health/live').expect(200).expect(({ body }) => expect(body.status).toBe('ok'));
    const ready = await http.get('/health/ready').expect(200);
    expect(ready.body.info).toMatchObject({ db: { status: 'up' }, redis: { status: 'up' } });
    await app.close();
  });
  it('ready is 503 when the database is unreachable', async () => {
    const { app, http } = await createTestApp({
      overrides: (b) => b.overrideProvider(DB_HEALTH_CLIENT).useValue(createPrismaClient('postgresql://app_user:app@localhost:1/none')),
    });
    const res = await http.get('/health/ready').expect(503);
    expect(res.body.error.db.status).toBe('down');
    await app.close();
  });
});
```

```ts
// apps/api/test/errors.e2e-spec.ts  (uses a TestController registered only here: GET /api/v1/__test/boom throws new Error('db password=secret'); POST /api/v1/__test/echo validates { name: z.string().min(2) })
it('wraps unknown errors without leaking internals and echoes the request id', async () => {
  const res = await http.get('/api/v1/__test/boom').set('X-Request-Id', 'req-123').expect(500);
  expect(res.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal error', requestId: 'req-123' });
  expect(JSON.stringify(res.body)).not.toContain('secret');
  expect(res.headers['x-request-id']).toBe('req-123');
});
it('returns 422 VALIDATION_FAILED with field paths', async () => {
  const res = await http.post('/api/v1/__test/echo').send({ name: 'a' }).expect(422);
  expect(res.body.code).toBe('VALIDATION_FAILED');
  expect(res.body.details.issues[0].path).toEqual(['name']);
  expect(ApiErrorBodySchema.safeParse(res.body).success).toBe(true);
});
it('returns 404 NOT_FOUND envelope for unknown routes', async () => {
  const res = await http.get('/api/v1/nope').expect(404);
  expect(res.body.code).toBe('NOT_FOUND'); expect(typeof res.body.requestId).toBe('string');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @nibras/api test` — Expected: FAIL (no app module).

- [ ] **Step 3: Implement the API skeleton**

`vitest.config.ts`: `unplugin-swc` (`swc.vite({ module: { type: 'es6' } })`), `test.include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts']`, `setupFiles: ['./test/setup.ts']` (loads `.env`, maps `_TEST` URLs, sets `NODE_ENV=test`), `fileParallelism: false` (shared DB).
`src/config/env.ts`, `src/common/*`, `src/health/*` per the Interfaces block. The health controller takes the DB client through an injectable token `DB_HEALTH_CLIENT` so the test can swap it. `app.module.ts` applies `RequestIdMiddleware` to `*` and registers the filter/pipe with `APP_FILTER`/`APP_PIPE`.
`package.json` scripts: `dev: nest start --watch`, `build: nest build`, `start: node dist/main.js`, `test: vitest run`, `lint`, `typecheck: tsc --noEmit -p tsconfig.json`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @nibras/api test` — Expected: all PASS. Then `pnpm --filter @nibras/api dev` and `curl -i localhost:3001/health/ready` → 200 JSON.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "feat(api): nestjs bootstrap with env validation, error envelope, request id and health checks"
```

---

### Task 5: `apps/api` observability baseline + OpenAPI export pipeline

**Files:**
- Create: `apps/api/src/observability/logger.module.ts`, `src/observability/metrics.controller.ts`, `src/observability/metrics.interceptor.ts`, `src/observability/tracing.ts`, `src/openapi/export.ts`
- Modify: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/package.json` (script `openapi:export`)
- Create: `packages/contracts/package.json` script `generate` (openapi-typescript), `packages/contracts/openapi/openapi.json`, `packages/contracts/src/generated/api.d.ts`, `packages/contracts/src/client.ts`
- Test: `apps/api/test/observability.e2e-spec.ts`, `apps/api/src/observability/logger.spec.ts`

**Interfaces:**
- Produces: nestjs-pino `LoggerModule` with `pino-http`, `genReqId` = `RequestContext` request id, `customProps` adds `request_id`; redaction paths `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.email`; pretty transport only when `NODE_ENV=development`. `GET /metrics` (outside the prefix) exposing prom-client default metrics + histogram `http_request_duration_seconds{method,route,status}` filled by `MetricsInterceptor`. `tracing.ts` is imported first in `main.ts` and starts `NodeSDK` with OTLP HTTP exporter + auto-instrumentations only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (service name `tt-api`). `openapi:export` writes `packages/contracts/openapi/openapi.json` (SwaggerModule document, title "TT API", version `1`, server `/api/v1`); `@nibras/contracts` exports `createApiClient(baseUrl: string, fetchImpl?: typeof fetch)` = `openapi-fetch` `createClient<paths>`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/observability/logger.spec.ts — build the pino options via the module's exported `buildPinoOptions(env)` and assert
expect(opts.redact.paths).toEqual(expect.arrayContaining(['req.headers.authorization', 'req.headers.cookie', '*.password', '*.email']));
// apps/api/test/observability.e2e-spec.ts
it('serves prometheus metrics with the request duration histogram', async () => {
  await http.get('/health/live');
  const res = await http.get('/metrics').expect(200);
  expect(res.text).toContain('http_request_duration_seconds_bucket');
  expect(res.text).toContain('process_cpu_seconds_total');
});
it('openapi document lists the health routes under the /api/v1 server', async () => {
  const doc = buildOpenApiDocument(app); // exported from src/openapi/export.ts
  expect(doc.info.title).toBe('TT API'); expect(doc.servers?.[0].url).toBe('/api/v1');
});
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/api test` — Expected: FAIL.

- [ ] **Step 3: Implement logger, metrics, tracing and the export script**

`buildPinoOptions(env: Env): Params` and `buildOpenApiDocument(app: INestApplication): OpenAPIObject` are the two exported pure helpers; `export.ts` has a `main()` that creates the app without listening, writes the JSON with 2-space indent, exits. `@nibras/contracts` `generate` script: `openapi-typescript ./openapi/openapi.json -o ./src/generated/api.d.ts`. Commit both generated files; CI (Task 9) regenerates and fails on diff.

- [ ] **Step 4: Run the tests and the generators**

Run: `pnpm --filter @nibras/api test && pnpm --filter @nibras/api openapi:export && pnpm --filter @nibras/contracts generate && pnpm --filter @nibras/contracts build`
Expected: PASS; `openapi.json` contains `/health/live`; `api.d.ts` compiles.

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/contracts && git commit -m "feat(api): pino logging, prometheus metrics, optional otel tracing and openapi export"
```

---

### Task 6: `packages/i18n` — messages for 3 locales, formatting helpers, key-parity test

**Files:**
- Create: `packages/i18n/package.json`, `tsconfig.json`, `vitest.config.ts`, `messages/fr.json`, `messages/ar.json`, `messages/en.json`, `src/index.ts`, `src/locales.ts`, `src/format.ts`
- Test: `packages/i18n/src/locales.test.ts`, `packages/i18n/src/format.test.ts`

**Interfaces:**
- Produces (`@nibras/i18n`): `messages: Record<Locale, AbstractIntlMessages>` (JSON imported, nested namespaces `common`, `nav`, `hello`, `errors`, `health`), `getMessages(locale)`, `flattenKeys(obj): string[]`, `formatDate(date: Date, locale: Locale, timeZone: string, opts?: Intl.DateTimeFormatOptions): string`, `formatNumber(n: number, locale: Locale): string`, `formatRelative(...)` left to SP5. Message JSON keys are the contract later plans extend; `errors.<ERROR_CODE>` is the convention for API error messages (SP0 ships `errors.VALIDATION_FAILED`, `errors.NOT_FOUND`, `errors.INTERNAL_ERROR`, `errors.RATE_LIMITED`, `errors.UNAUTHENTICATED`, `errors.PERMISSION_DENIED`).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/i18n/src/locales.test.ts
it('every locale has exactly the same key set as fr (no missing, no extra)', () => {
  const fr = flattenKeys(messages.fr).sort();
  for (const l of ['ar', 'en'] as const) expect(flattenKeys(messages[l]).sort()).toEqual(fr);
});
it('no message is empty or still the French text in ar/en', () => {
  for (const l of ['ar', 'en'] as const) for (const k of flattenKeys(messages[l]))
    expect(getPath(messages[l], k), `${l}:${k}`).not.toBe('');
});
it('ar has no untranslated placeholders', () => { for (const k of flattenKeys(messages.ar)) expect(getPath(messages.ar, k)).not.toMatch(/^TODO/); });
// packages/i18n/src/format.test.ts
it('formats dates in the viewer timezone with western digits in Arabic', () => {
  const d = new Date('2026-10-15T14:00:00Z');
  expect(formatDate(d, 'ar', 'Africa/Tunis', { hour: '2-digit', minute: '2-digit' })).toMatch(/15:00|03:00/);
  expect(formatDate(d, 'ar', 'Africa/Tunis', { hour: '2-digit', minute: '2-digit' })).not.toMatch(/[٠-٩]/);
  expect(formatDate(d, 'fr', 'Europe/Paris', { hour: '2-digit', minute: '2-digit' })).toContain('16:00');
});
it('uses the Gregorian calendar for ar', () => { expect(formatDate(new Date('2026-10-15T12:00:00Z'), 'ar', 'Africa/Tunis', { year: 'numeric' })).toContain('2026'); });
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/i18n test` — Expected: FAIL.

- [ ] **Step 3: Write the messages and helpers**

`hello` namespace: `title` (fr `Bonjour`, ar `مرحباً`, en `Hello`), `subtitle` (fr `Plateforme de cours en ligne — environnement de développement`), `switchLocale`; `nav.{dashboard,courses,students,sessions,messages,notifications,settings}` from PRD §9.1 French labels (`Dashboard`, `Cours`, `Étudiants`, `Sessions`, `Messages`, `Notifications`, `Paramètres`); `common.{appName: "Plateforme cours", loading, retry}`; `health.{ok}`; `errors.*` as listed. Arabic copy must be real Arabic (builder writes; native review is a §22 deliverable, not a blocker). `formatDate` uses `new Intl.DateTimeFormat(intlTag(locale), { timeZone, calendar: 'gregory', ...opts })`.

- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm --filter @nibras/i18n test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n && git commit -m "feat(i18n): fr/ar/en message catalogues with parity test and Intl helpers"
```

---

### Task 7: `packages/ui` minimal design system + `apps/web` Next.js app with locale routing, RTL and hello page

**Files:**
- Create: `packages/ui/package.json`, `tsconfig.json`, `vitest.config.ts` (jsdom), `src/index.ts`, `src/button.tsx`, `src/app-shell.tsx`, `src/styles.css`, `src/button.test.tsx`
- Create: `apps/web/package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `src/app/globals.css`, `src/proxy.ts`, `src/i18n/routing.ts`, `src/i18n/request.ts`, `src/app/[locale]/layout.tsx`, `src/app/[locale]/page.tsx`, `src/app/health/route.ts`, `src/lib/api.ts`, `src/components/locale-switcher.tsx`
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/hello.spec.ts`

**Interfaces:**
- Produces (`@nibras/ui`): `Button({ variant: 'primary' | 'secondary' | 'danger', size?, ...props })`, `AppShell({ locale, dir, nav: NavItem[], children })` using only logical CSS properties; `styles.css` imports Tailwind 4 and the `@nibras/config` preset; direction comes from the `dir` attribute on `<html>`, never from a prop that toggles left/right classes.
- Produces (`@nibras/web`): `routing = defineRouting({ locales: LOCALES, defaultLocale: DEFAULT_LOCALE, localePrefix: 'always' })`; `src/proxy.ts` exports next-intl's `createMiddleware(routing)` with `localeDetection: true` (cookie `NEXT_LOCALE` then `Accept-Language`); `[locale]/layout.tsx` renders `<html lang={locale} dir={dirOf(locale)}>` and loads `getMessages(locale)` from `@nibras/i18n`, `next/font` IBM Plex Sans Arabic; `next.config.ts` has `transpilePackages: ['@nibras/ui', '@nibras/i18n', '@nibras/contracts']` and `rewrites: [{ source: '/api/:path*', destination: `${process.env.API_URL}/api/:path*` }]` so the browser talks to the API same-origin (cookies in SP1 work without CORS); `src/lib/api.ts` exports `api = createApiClient('/api/v1')` for client components and `serverApi()` (adds the incoming `cookie` header) for server components; `GET /health` → `200 { status: 'ok' }`. Playwright config: `baseURL http://localhost:3000`, `webServer` starts `pnpm --filter @nibras/web dev` (reuse existing), projects `chromium` + `mobile` (Pixel 7 viewport).

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/ui/src/button.test.tsx (jsdom + @testing-library/react)
it('renders a primary button with the label and type=button by default', () => {
  render(<Button variant="primary">Enregistrer</Button>);
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toHaveAttribute('type', 'button');
});
```

```ts
// apps/web/e2e/hello.spec.ts
for (const [locale, title, dir] of [['fr', 'Bonjour', 'ltr'], ['ar', 'مرحباً', 'rtl'], ['en', 'Hello', 'ltr']] as const) {
  test(`hello page in ${locale}`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('html')).toHaveAttribute('dir', dir);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe(dir);
    const raw = await page.locator('body').innerText();
    expect(raw).not.toMatch(/\b(hello|nav|common)\.[a-z]+\b/i); // no raw message keys
  });
}
test('Accept-Language negotiation', async ({ browser }) => {
  const cases = [['ar-TN,fr;q=0.8', '/ar'], ['fr-FR,fr;q=0.9', '/fr'], ['de-DE', '/fr'], ['en-US,en;q=0.9', '/en']];
  for (const [header, path] of cases) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'Accept-Language': header } });
    const page = await ctx.newPage(); await page.goto('/');
    expect(new URL(page.url()).pathname).toBe(path); await ctx.close();
  }
});
test('web health route', async ({ request }) => { const r = await request.get('/health'); expect(r.status()).toBe(200); expect(await r.json()).toEqual({ status: 'ok' }); });
test('locale switcher keeps the page and flips direction', async ({ page }) => {
  await page.goto('/fr'); await page.getByRole('link', { name: 'العربية' }).click();
  await expect(page).toHaveURL(/\/ar$/); await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/ui test` and `pnpm --filter @nibras/web e2e` — Expected: FAIL (no app).

- [ ] **Step 3: Implement `@nibras/ui` and the web app**

`AppShell` nav uses `nav.*` messages; the hello page renders `<h1>{t('hello.title')}</h1>`, the subtitle, and `LocaleSwitcher` (three links with native names `Français`, `العربية`, `English`, `hrefLang`). next-intl `getRequestConfig` in `src/i18n/request.ts` sets `onError` to **throw** in non-production so a missing key fails the e2e run (Review Focus 2), and `getMessageFallback` to the raw key in production. Mobile: body has 16px inline padding, no horizontal scroll at 360px.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @nibras/ui test && pnpm --filter @nibras/web build && pnpm --filter @nibras/web e2e` — Expected: unit PASS; build succeeds; 7 e2e tests PASS on both projects.

- [ ] **Step 5: Commit**

```bash
git add packages/ui apps/web && git commit -m "feat(web): next.js app with fr/ar/en routing, rtl layout, hello page and e2e smoke"
```

---

### Task 8: `apps/worker` — NestJS standalone BullMQ worker with health server and a ping queue round-trip

**Files:**
- Create: `apps/worker/package.json`, `tsconfig.json`, `nest-cli.json`, `vitest.config.ts`, `src/main.ts`, `src/env.ts`, `src/worker.module.ts`, `src/queues.ts`, `src/health-server.ts`, `src/processors/ping.processor.ts`, `src/logger.ts`
- Test: `apps/worker/test/ping.e2e-spec.ts`, `apps/worker/test/health.e2e-spec.ts`

**Interfaces:**
- Produces: `createWorkerContext(): Promise<{ app: INestApplicationContext; close(): Promise<void> }>`; `queues.ts` registers a BullMQ `Queue` and `Worker` for every name in `QUEUES` (concurrency 5, Redis from `REDIS_URL`, `defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 1000, removeOnFail: 5000 }`) and a `ProcessorRegistry` where `registerProcessor(queue: QueueName, jobName: string, handler: (job: Job) => Promise<unknown>)` routes by `job.name`; unknown job names fail the job with `UnknownJobError`. Ping: queue `compliance`, job `system.ping` returns `{ pong: job.data.msg }`. Health server: plain `node:http` on `WORKER_PORT`, `/health/live` 200, `/health/ready` 200 only when Redis `PING` answers and every Worker `isRunning()`, else 503. Worker DB client is `createPrismaClient(env.DATABASE_URL_SYSTEM)` exposed as `WORKER_DB` token (BYPASSRLS, PRD §13.3 — every job logs `workspace_id` it touches).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/worker/test/ping.e2e-spec.ts
it('processes system.ping on the compliance queue', async () => {
  const ctx = await createWorkerContext();
  const q = new Queue(QUEUES.compliance, { connection: redisOpts });
  const job = await q.add('system.ping', { msg: 'hi' });
  await expect(job.waitUntilFinished(new QueueEvents(QUEUES.compliance, { connection: redisOpts }))).resolves.toEqual({ pong: 'hi' });
  await ctx.close();
});
it('fails unknown job names', async () => { /* add 'nope.job' → waitUntilFinished rejects with /UnknownJob/ */ });
// apps/worker/test/health.e2e-spec.ts
it('live 200, ready 200 with redis, ready 503 when redis is down', ...) // second context built with REDIS_URL=redis://localhost:1
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/worker test` — Expected: FAIL.

- [ ] **Step 3: Implement the worker** — scripts `dev: nest start --watch`, `build`, `start`, `test`; pino logger with `service: 'tt-worker'`; graceful shutdown closes workers then Redis.

- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm --filter @nibras/worker test` — Expected: PASS. Then `pnpm dev` from the root: web, api, worker all start; `curl localhost:3002/health/ready` → 200.

- [ ] **Step 5: Commit**

```bash
git add apps/worker && git commit -m "feat(worker): bullmq worker with queue registry, ping processor and health server"
```

---

### Task 9: CI, container images, staging compose and runbooks

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy-staging.yml`, `infra/docker/web.Dockerfile`, `infra/docker/api.Dockerfile`, `infra/docker/worker.Dockerfile`, `infra/docker/.dockerignore`, `infra/compose.staging.yml`, `docs/runbooks/staging.md`
- Modify: `docs/runbooks/local-dev.md` (CI + images section), `turbo.json` (if `prune` needs `globalDependencies` tweaks)

**Interfaces:**
- Produces: `ci.yml` jobs — `check` (ubuntu-latest, services `postgres:17` with `init.sql` mounted via a checkout step + `psql`, `redis:7`, `axllent/mailpit`; steps: pnpm install with cache, `pnpm lint`, `pnpm typecheck`, `pnpm --filter @nibras/db migrate:deploy` on both DBs, `pnpm test`, `pnpm build`, `pnpm --filter @nibras/api openapi:export && pnpm --filter @nibras/contracts generate && git diff --exit-code packages/contracts`), `windows-check` (windows-latest: install, `pnpm lint`, `pnpm typecheck`, `pnpm test --filter=@nibras/contracts --filter=@nibras/i18n --filter=@nibras/ui` — DB-free packages), `migrate-check` (`pnpm --filter @nibras/db migrate:check` → fails on schema/migration drift), `e2e` (ubuntu: services as above, `pnpm --filter @nibras/web exec playwright install --with-deps chromium`, start api + worker in background, `pnpm --filter @nibras/web e2e`), `images` (on push to `main` only: `docker/build-push-action` for the three Dockerfiles → `ghcr.io/<owner>/tt-{web,api,worker}:{sha,latest}`). Dockerfiles: multi-stage with `turbo prune --docker`, `node:22-alpine`, non-root user, `HEALTHCHECK` hitting `/health/live`; API image runs `prisma migrate deploy` only via an explicit `migrate` entrypoint arg (never on boot). `compose.staging.yml`: `web`, `api`, `worker` from GHCR + `postgres`, `redis`, `minio` with `env_file: .env.staging`, api runs the `migrate` one-shot before start. `deploy-staging.yml`: on `workflow_run` of `images` success, `if: ${{ secrets.STAGING_SSH_HOST != '' }}` guarded through a `vars` check, uses `appleboy/ssh-action` to `docker compose -f compose.staging.yml pull && up -d`.

- [ ] **Step 1: Write the workflows and Dockerfiles** (no unit test applies; verification is the pipeline itself)

- [ ] **Step 2: Verify images build locally**

Run: `docker build -f infra/docker/api.Dockerfile -t tt-api . && docker run --rm --env-file .env --network host tt-api node -e "console.log('ok')"` and the same for `web` and `worker`.
Expected: three images build; `docker run --rm --network host --env-file .env tt-api` then `curl localhost:3001/health/live` → 200.

- [ ] **Step 3: Verify CI** — push a branch and open a PR: Expected: `check`, `windows-check`, `migrate-check`, `e2e` all green; `images` skipped on the PR, runs on merge to `main`.

- [ ] **Step 4: Write `docs/runbooks/staging.md`** — required secrets (`STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY`, GHCR read token), host prerequisites (Docker, `.env.staging` with real secrets, EU-Paris region per D-P4), first-run steps, rollback = re-tag previous image and `up -d`, how to run `migrate` manually.

- [ ] **Step 5: Commit**

```bash
git add .github infra docs && git commit -m "ci: lint/typecheck/test/build/migration-check on linux and windows, playwright e2e, container images and staging compose"
```

---

## Self-review notes (performed while writing)

- **Spec coverage (PRD §18 SP0 DoD):** `pnpm dev` (Task 1+2+8), CI green (9), staging accessible (9 — images + compose + deploy workflow; the host itself is an owner/ops action, see spec gaps), hello page FR/AR/EN with RTL (7), `/health` on 3 apps (4, 7, 8), empty Prisma schema migrated (2), logs/metrics/traces (5), secrets handling (2, 9), i18n skeleton + minimal design system (6, 7), docker-compose Postgres/Redis/MinIO (+ Mailpit per owner; LiveKit dev container deferred to SP6 where it is first consumed).
- **Type consistency:** `createPrismaClient`, `systemPrisma`, `resetDatabase`, `ApiError`, `RequestContext`, `createTestApp`, `QUEUES`, `dirOf`, `intlTag`, `createApiClient`, `registerProcessor` are the names SP1 consumes; they are spelled identically in every task above.
- **Proportion:** nine tasks, signatures and assertions only; no function bodies beyond pinned values.
