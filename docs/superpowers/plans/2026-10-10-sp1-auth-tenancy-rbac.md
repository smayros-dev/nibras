# SP1 — Auth, Tenancy & RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use **superpowers:subagent-driven-development** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Model policy (owner decision, overrides the skill's default tiers):** every implementer, task reviewer, re-reviewer and fixer subagent runs on **Opus** (`model: "opus"`). Changes to this plan, the spec or the architecture go back to **Fable** (`model: "fable"`). Always pass the model explicitly when dispatching.
>
> **Prerequisite:** SP0 (`docs/superpowers/plans/2026-10-10-sp0-monorepo-infra.md`) is merged on `main` (cffc281). This plan consumes SP0's interfaces exactly as they exist on `main`:
> - `@nibras/db`: `createPrismaClient(url = process.env.DATABASE_URL): PrismaClient` (emits `warn`/`error` log **events**, no default listener), `systemPrisma(): PrismaClient` (singleton on `DATABASE_URL_SYSTEM`), `resetDatabase(client = systemPrisma())` (TRUNCATEs every public table; **refuses** a database whose name does not end in `_test`).
> - `@nibras/contracts` (`src/index.ts` re-exports `error-codes`, `errors`, `locale`, `queues`, `client`, `redact`): `ERROR_CODES` (`VALIDATION_FAILED`, `NOT_FOUND`, `UNAUTHENTICATED`, `PERMISSION_DENIED`, `RATE_LIMITED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`), `ApiErrorBody`, `LOCALES`/`Locale`/`LocaleSchema`/`dirOf`/`intlTag`, `QUEUES`/`QueueName`, `DEFAULT_JOB_OPTIONS` (attempts 3, exponential 1000, keep 1000/5000), `createApiClient(baseUrl, fetchImpl?)` (openapi-fetch; `baseUrl` **includes** `/api/v1`), `REDACT_KEYS`/`redactPaths(depth = 3)` (shared by the API and worker pino loggers).
> - `apps/api`: `ApiError(status, code: ErrorCode, message, details?)` (`src/common/api-error.ts`) — the **only** way to raise a domain error; `HttpExceptionFilter` maps bare 401/403/404/413/415/429 and 503 by status to the generic codes, so every guard/service that needs a stable code throws `ApiError`; `RequestContext.get()/run(store, fn)` over `RequestStore { requestId; ip; userAgent }` (`src/common/request-context.ts`); `ZodValidationPipe`/`createZodDto` (nestjs-zod); `REDIS` token (ioredis client, `src/redis/redis.module.ts`); `configureApp(app)` + `API_PREFIX = 'api/v1'`; `env` from `src/config/env.ts` (incl. `TRUST_PROXY_HOPS`, default 1 — `X-Forwarded-For` is honoured in tests); `createTestApp({ overrides?, controllers? }): Promise<{ app, http, logs }>` (`test/helpers/app.ts`; `controllers` mounts test-only routes).
> - `apps/worker`: `ProcessorRegistry.registerProcessor(queue: QueueName, jobName: string, handler: (job: Job) => Promise<unknown>)` (processors register in `onModuleInit`, see `processors/ping.processor.ts`), `redisConnection(url)` (rejects non-`redis:`/`rediss:`), `createLogger(level, destination?)`, test helper `obliterateAllQueues()` (`test/redis.ts`).
> - `apps/web`: `api = createApiClient('/api/v1')` and `async serverApi()` (`src/lib/api.ts`) which forwards `cookie`, `x-forwarded-for`, `x-request-id`, `accept-language` (`forwardHeaders`, `src/lib/forwarded-headers.ts`); `AppShell` lives in `@nibras/ui` (`packages/ui/src/app-shell.tsx`); locale routing in `src/proxy.ts`.
> - `@nibras/config`: `applyTestEnv(pkg: 'db' | 'api' | 'worker', env)` (`vitest/test-env.ts`) rewrites `DATABASE_URL_TEST`, `DATABASE_URL_TEST_SYSTEM`, `REDIS_URL_TEST` to `nibras_<pkg>_test` and Redis DB `13 | 14 | 15`; it runs from `packages/db/vitest.setup.ts`, `apps/api/test/setup.ts`, `apps/worker/vitest.setup.ts`. Tests read DB/Redis **only** from env.
>
> **Execution notes (owner rulings carried from SP0):**
> - Tasks may run in **parallel git worktrees** (at most **2** implementers at once — the dev machine has no page file and parallel esbuild/node crash with `cannot allocate memory`). Each worktree copies the root `.env` and sets `TEST_DB_PREFIX=nibras_t<N>` and `TEST_REDIS_DB_BASE` (`10` for the first worktree, `7` for the second; the main checkout keeps the default `13`, so the three sets `7–9`, `10–12`, `13–15` never overlap — Task 0 adds both knobs) so its test databases are `nibras_t<N>_{db,api,worker}_test` (names end in `_test`, as `resetDatabase` requires) and its Redis indexes do not collide; run `pnpm db:migrate:test` in the worktree first (Prisma creates missing databases — `app_system` has `CREATEDB`). All worktrees share the one docker compose stack (`name: nibras`) from the main checkout. Drop the `nibras_t<N>_*` databases when the worktree is removed.
> - Every verification command that runs turbo uses `--concurrency=2`: `pnpm turbo run lint typecheck test --concurrency=2` (never bare `pnpm test` across the repo).
> - **DB workflow:** schema change → `pnpm --filter @nibras/db migrate:dev -- --name <name> --create-only` (wrapper strips pnpm's `--`) → edit the SQL when hand-written statements are needed → `pnpm db:migrate` (dev DB `nibras`) → `pnpm db:migrate:test` (migrates `nibras_db_test`, `nibras_api_test`, `nibras_worker_test`, or the prefixed worktree set) → `pnpm --filter @nibras/db migrate:check` (shadow DB, no drift). Never call `prisma migrate dev` directly.
> - **Turbo strict env:** a variable a test or build reads must be listed in `turbo.json` (`test.env` / `build.env`), in `.github/workflows/ci.yml` `env`, and in `.env.example`, or the task silently does not see it. SP1's known variables (`JWT_SECRET`, `TOTP_ENCRYPTION_KEY`, `EMAIL_FROM`, `SMTP_URL`, `SMS_PROVIDER`, `HIBP_ENABLED`, `COOKIE_SECURE`, plus `TRUST_PROXY_HOPS`) are **already present in all three**; a task that adds another variable adds it to all three in the same commit.

**Goal:** Users can register as teachers, verify email and phone, log in with rotating sessions, 2FA and rate limits, accept versioned consents, own a personal workspace or create an organisation, manage members and teacher↔student assignments under the §7 permission matrix, with every tenant row isolated by a Prisma extension **and** PostgreSQL RLS, every sensitive action in an append-only audit log, abuse reports queued for admins, and a minimal super-admin console that can suspend workspaces and teachers.

**Architecture:** `packages/db` gains the identity/tenancy schema, the `tenantDb(workspaceId)` extension (injects `workspace_id` and `SET LOCAL app.workspace_id` per operation) and RLS policies. `apps/api` gains modules `auth`, `me`, `tenancy` (workspace context + permission guards), `workspaces`, `members`, `abuse-reports`, `admin`, `audit`, `queue`, `providers`; guards run in the order JWT → account gates (suspended / email unverified / pending consents / 2FA setup) → workspace context → permission → teacher-verified. `packages/providers` holds `EmailProvider` (SMTP→Mailpit, in-memory) and `SmsProvider` (log, in-memory) with FR/AR/EN templates. `apps/web` gains the auth, settings, workspace and admin screens on top of SP0's locale routing; the browser reaches the API same-origin through the `/api` rewrite so auth cookies need no CORS.

**Tech Stack additions (pin majors, latest stable patch):** argon2 (node) 0.4x · jose 6 · otplib 12 · nodemailer 7 · libphonenumber-js 1 · @nestjs/throttler 6 (+ Redis storage) · @nestjs/event-emitter 3 · @nestjs/bullmq 11 · cookie-parser 1 · helmet 8 · intl-messageformat 10 · qrcode 1 (web) · @testing-library/react 16.

**Spec:** `docs/superpowers/specs/2026-10-10-plateforme-cours-design.md` → `PRD.md` v2.1. This plan implements PRD §18 sub-project **1** and depends on §4 (D-O6, D-O7, D-P12, D-P13, D-P14), §6, §7, §8.1, §8.2, §8.16.2–8.16.4, §11.1–11.2, §11.7, §12.1 (Auth, Moi, Espaces, Membres, Signalements, Super-admin rows), §13.3, §14.7, §15.1, §15.2, §15.13 (AC-GDPR-05/06), §15.16, §22.

## Global Constraints

Everything in SP0's Global Constraints still applies. In addition:

- Owner-locked rules (PRD §22) this plan must not reinterpret: D-O6 teacher safeguards, D-O7 invited-teacher workspace rule, D-P12 2FA policy, D-P13 double isolation, the §7 permission matrix, storage quotas 20 GiB personal / 200 GiB organisation (D-P15).
- Password policy (§8.1.1): ≥ 12 characters, no composition rules, rejected if in the 10 000 most common or found via HIBP k-anonymity, hashed with argon2id.
- Sessions (§8.1.2): access JWT 15 min; rotating refresh token 30 days in cookie `httpOnly; Secure; SameSite=Lax`; refresh reuse → whole family revoked + security email; "remember this device" = 30-day persistent cookie, otherwise session cookie with the same 30-day server lifetime (planner ruling — the PRD gives only the 30-day figure).
- Rate limits (§8.1.2, §14.7): login 5 attempts/min per IP+email then exponential backoff; lock 15 min after 10 failures with alert email; API 600 req/min per authenticated user; 60 req/min per unauthenticated IP.
- 2FA (D-P12): TOTP + 10 recovery codes; mandatory for `SUPER_ADMIN` and `OWNER`/`ADMIN` of an `ORGANIZATION` workspace, enforced at the first request after obtaining the role; available to everyone.
- Email verification link 24 h; password reset link 1 h single use and invalidates all sessions; reset never reveals whether the account exists.
- Teachers (D-O6): phone verified by SMS OTP (`User.phone_verified_at`) and `CODE_OF_CONDUCT` consent; until email + phone + code of conduct are done, `403 TEACHER_NOT_VERIFIED` with `details.missing`.
- Tenancy: `/workspaces/{wid}/…` for a non-member → `404 NOT_FOUND` (never 403) + audit `auth.forbidden_workspace` (AC-WS-01); suspended workspace → reads allowed, mutations `423 WORKSPACE_SUSPENDED` (AC-WS-06); tenant query without context → PostgreSQL returns 0 rows and the extension throws `TENANT_CONTEXT_MISSING` (AC-WS-07).
- Audit log (§8.16.3, §11.7): append-only; the `app_user` role has no UPDATE/DELETE on it (AC-GDPR-05); entries carry actor id + role, ip, user-agent, request id, action, entity, before/after JSON of sensitive fields only (never hashes or secrets).
- Consent versions live in `@nibras/contracts` `CONSENT_VERSIONS = { TERMS: 'terms-2026-10', PRIVACY: 'privacy-2026-10', CODE_OF_CONDUCT: 'coc-2026-10', MARKETING: 'marketing-2026-10' }`; a bumped version must be re-accepted at the next request (AC-GDPR-06).
- Personal workspace name on signup: `Espace de {prénom}`; slug = `slugify(name)-{6 lowercase base32 chars}`.
- Stable error codes added by this plan (append to `ERROR_CODES` in `@nibras/contracts`): `EMAIL_TAKEN`, `INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`, `TOKEN_INVALID`, `PASSWORD_TOO_SHORT`, `PASSWORD_TOO_COMMON`, `PASSWORD_COMPROMISED`, `ACCOUNT_LOCKED`, `ACCOUNT_SUSPENDED`, `SESSION_REVOKED`, `TWO_FACTOR_REQUIRED`, `TWO_FACTOR_SETUP_REQUIRED`, `TWO_FACTOR_INVALID`, `TWO_FACTOR_MANDATORY`, `TWO_FACTOR_ALREADY_ENABLED`, `CONSENT_REQUIRED`, `CONSENT_VERSION_MISMATCH`, `CONSENT_NOT_REVOCABLE`, `OTP_INVALID`, `OTP_EXPIRED`, `TEACHER_NOT_VERIFIED`, `WORKSPACE_SUSPENDED`, `MEMBERSHIP_INACTIVE`, `PERSONAL_WORKSPACE_FORBIDDEN`, `PERSONAL_WORKSPACE_EXISTS`, `NOT_AN_ORGANIZATION`, `OWNER_CANNOT_BE_REMOVED`, `ROLE_CHANGE_NOT_ALLOWED`, `MEMBER_HAS_FUTURE_SESSIONS`, `ALREADY_MEMBER`, `ALREADY_ASSIGNED`, `ENTITY_TYPE_UNSUPPORTED`, `CANNOT_SUSPEND_SUPER_ADMIN`, `TENANT_CONTEXT_MISSING`.
- UI copy: French strings quoted from the PRD are verbatim; AR/EN are the builder's translations (native Arabic review is a §22 deliverable, not a gate for this plan).
- Errors: guards, pipes and services throw `new ApiError(status, code, message, details?)` with one of the stable codes above — never Nest's `UnauthorizedException`/`ForbiddenException`/`NotFoundException`, which the SP0 filter renders as the generic `UNAUTHENTICATED`/`PERMISSION_DENIED`/`NOT_FOUND`. Those bare exceptions are allowed only where the generic code *is* the intended one (e.g. the 404 of AC-WS-01).
- Secret field names (log redaction, Task 0): every DTO, event, job payload and provider param that carries a one-time code uses `otpCode`, `verificationCode` or `recoveryCode` — never a bare `code` (which is the API error code and Prisma/Node `err.code`). Request-body and job-data fields named `code` are still redacted through the scoped paths `body.code` / `data.code`.
- Prisma log events (`warn`, `error`) are forwarded to pino by the API (Task 5) and the worker keeps SP0's behaviour; nothing else attaches listeners.

## Review Focus

Five failure modes the spec implies but no acceptance criterion exercises; each has its test added to the owning task below.

1. **Cross-tenant leakage through aggregates and lookups** — `GET /me/workspaces` and `GET /me/abuse-reports` must return only the caller's rows; `GET /workspaces/{A}/members/{uid}` for a user who is a member of B only must be 404, not B's record. → Tasks 15, 16.
2. **Email identity normalisation** — `" Ahmed@Example.com "` must be trimmed and matched case-insensitively at register (409 when `ahmed@example.com` exists), login, verification and reset; two accounts differing only by case must be impossible. → Tasks 6, 7.
3. **2FA bypass** — a 2FA challenge token must not work as an access token, must not be replayable, a recovery code must be single-use, and an org admin must not be able to disable mandatory 2FA. → Task 10.
4. **Invalid timezone / locale / birth date accepted silently** — `timezone: "Europe/Tunis"` (not IANA), `locale: "de"`, a birth date in the future or before 1900 must all be `422 VALIDATION_FAILED` at register and `PATCH /me`. → Tasks 6, 11.
5. **RTL and translation on auth surfaces** — the AR register/login/2FA forms must render `dir="rtl"` with translated validation messages (no raw keys), and AR emails must carry `dir="rtl"` and an Arabic subject. → Tasks 3, 19.

(Invitation-token reuse belongs to SP2's invitation entity; the equivalent single-use rules for verification, reset and email-change tokens are tested in Tasks 6 and 9.)

---

## File Structure

```
packages/config/vitest/{test-env.mjs,test-env.d.mts}      (Task 0, replaces test-env.ts) single source of nibras_<pkg>_test / Redis index derivation + worktree knobs
packages/db/scripts/migrate-test.mjs                      (Task 0, imports the .mjs above)
packages/contracts/src/redact.ts                          (Task 0) REDACT_KEYS without bare `code`; REDACT_SCOPED_PATHS
turbo.json  apps/api/src/config/env.ts  docs/runbooks/staging.md   (Task 0 carry-overs)
packages/config/eslint/nest.mjs                           (Task 5) type-aware no-floating-promises for api + worker
pnpm-workspace.yaml                                       (Task 4) argon2 in onlyBuiltDependencies

packages/contracts/src/{error-codes,consents,permissions,workspace-settings,auth,me,workspaces,members,abuse,admin}.ts
packages/db/prisma/schema.prisma + migrations/<ts>_identity_tenancy, <ts>_rls_and_audit_privileges
packages/db/src/{tenant,index}.ts  src/tenant.test.ts
packages/providers/src/email/{types,smtp,in-memory,templates/index,templates/layout}.ts
packages/providers/src/sms/{types,log,in-memory}.ts  src/index.ts  src/email/templates.test.ts
packages/i18n/messages/{fr,ar,en}.json                 + namespaces auth, settings, workspace, members, admin, abuse, emails, errors

apps/api/src/config/env.ts                             + JWT_SECRET, TOTP_ENCRYPTION_KEY, SMTP_URL, EMAIL_FROM, SMS_PROVIDER, HIBP_ENABLED, COOKIE_SECURE; REDIS_URL restricted to redis:/rediss:
apps/api/src/db/{db.module,prisma-logs}.ts             (Task 5) Prisma warn/error events → pino
apps/api/src/observability/metrics.middleware.ts       (Task 5) replaces metrics.interceptor.ts so guard rejections are measured
apps/api/src/providers/providers.module.ts             EMAIL_PROVIDER / SMS_PROVIDER tokens
apps/api/src/queue/{queue.module,queue.service}.ts     QueueService.add(queue, name, data, opts)
apps/api/src/audit/{audit.module,audit.service}.ts
apps/api/src/common/request-context.ts                 (modify) RequestStore gains user/session/workspace/membership/permissionScope
apps/api/src/auth/crypto/{password,password-policy,hibp,tokens,secret-box}.ts   + *.spec.ts
apps/api/src/auth/{auth.module,auth.controller,auth.service,register.service,session.service,jwt.service,login-throttle.service,two-factor.service,password-reset.service,email-change.service}.ts
apps/api/src/auth/guards/{jwt-auth.guard,account-gates.guard}.ts  decorators/{public,allow-unverified,current-user}.ts
apps/api/src/me/{me.module,me.controller,me.service,consent.service,phone.service,verification.service}.ts
apps/api/src/tenancy/{tenancy.module,workspace-context.guard,permission.guard,teacher-verified.guard,super-admin.guard,decorators.ts,permissions.ts}
apps/api/src/workspaces/{workspaces.module,workspaces.controller,workspaces.service,workspace-settings.service,audit-log.controller}.ts
apps/api/src/members/{members.module,members.controller,members.service,membership.service,assignments.controller,assignments.service,removal-blockers.ts}
apps/api/src/abuse-reports/{abuse-reports.module,abuse-reports.controller,abuse-reports.service,snapshot.registry}.ts
apps/api/src/admin/{admin.module,admin.controller,admin.service,user-suspension.service}.ts
apps/api/src/cli/create-super-admin.ts
apps/api/test/helpers/{app,factories,auth}.ts  test/isolation/tenant-routes.e2e-spec.ts  test/**/*.e2e-spec.ts
apps/worker/src/processors/abuse.processor.ts

packages/ui/src/app-shell.tsx (+ app-shell.test.tsx)   (Task 19) named nav landmark + skip link
apps/web/src/lib/{api,session,auth-redirects}.ts
apps/web/src/app/[locale]/(auth)/{register,login,verify-email,forgot-password,reset-password,2fa,2fa/setup}/page.tsx
apps/web/src/app/[locale]/(app)/layout.tsx   app/page.tsx   app/settings/{profile,security,verification,consents,workspaces}/page.tsx
apps/web/src/app/[locale]/(app)/app/w/[wid]/{settings,members,audit-log}/page.tsx
apps/web/src/app/[locale]/(admin)/admin/{workspaces,abuse-reports}/page.tsx
apps/web/src/components/{consent-gate,workspace-switcher,onboarding-checklist,timezone-banner,report-abuse-button,suspended-banner,form}.tsx
apps/web/e2e/helpers/{mailpit,totp}.ts  e2e/{auth,settings,workspaces,admin,smoke}.spec.ts
```

---

### Task 0: SP0 carry-overs — redaction keys, single-source test-DB derivation with worktree knobs, turbo `e2e` ordering, env comment, staging caveat

Runs first (no dependency on any SP1 task); every later task's worktree relies on the knobs it adds. A reviewer could reject the redaction change while approving the schema, so it is not folded into Task 1.

**Files:**
- Create: `packages/config/vitest/test-env.mjs`, `packages/config/vitest/test-env.d.mts` (replace `test-env.ts`; delete it)
- Modify: `packages/config/package.json` (`"./vitest/test-env": { "types": "./vitest/test-env.d.mts", "default": "./vitest/test-env.mjs" }`), `packages/config/vitest/test-env.test.ts`, `packages/db/scripts/migrate-test.mjs`, `packages/contracts/src/redact.ts`, `packages/contracts/src/redact.test.ts`, `apps/api/src/observability/logger.spec.ts`, `apps/worker/src/logger.test.ts`, `turbo.json`, `.env.example`, `.github/workflows/ci.yml`, `apps/api/src/config/env.ts` (comment only), `docs/runbooks/staging.md`, `docs/runbooks/local-dev.md`
- Test: `packages/config/vitest/test-env.test.ts`, `packages/contracts/src/redact.test.ts`, `apps/api/src/observability/logger.spec.ts`, `apps/worker/src/logger.test.ts`

**Interfaces:**
- Produces (`@nibras/config/vitest/test-env`, plain ESM so `migrate-test.mjs` imports the same file — Node ≥ 22 without type stripping): `TEST_PACKAGES`, `TestPackage`, `testDbName(pkg, env = process.env): string` = `` `${env.TEST_DB_PREFIX ?? 'nibras'}_${pkg}_test` ``, `testRedisDb(pkg, env = process.env): number` = `base + { db: 0, api: 1, worker: 2 }[pkg]` with `base = Number(env.TEST_REDIS_DB_BASE ?? 13)` (throws unless an integer in `1..13`, so the three indexes stay in `1..15` and never hit `0`), `testDatabaseUrl(base, pkg, env?)`, `testRedisUrl(base, pkg, env?)`, `applyTestEnv(pkg, env)` (same contract as today, now honouring the two knobs). `TEST_REDIS_DB` constant is removed (callers use `testRedisDb`). `migrate-test.mjs` imports `testDbName` from `@nibras/config/vitest/test-env` (`@nibras/config` is already a workspace dependency of `@nibras/db`; otherwise add it) and migrates `testDbName(pkg)` for each `TEST_PACKAGES` entry.
- `turbo.json`: `test.env` gains `TEST_DB_PREFIX`, `TEST_REDIS_DB_BASE`; `e2e` task becomes `{ "dependsOn": ["^build"], "cache": false }`. `.env.example` documents both knobs commented out (`# TEST_DB_PREFIX=nibras_t1` / `# TEST_REDIS_DB_BASE=10`) under the test-DB comment; CI `env` is unchanged (defaults apply; the strict-env rule still requires the `turbo.json` entry).
- `@nibras/contracts`: `REDACT_KEYS` drops `'code'` and gains `'otpCode'`, `'verificationCode'`, `'recoveryCode'`; new `REDACT_SCOPED_PATHS = ['body.code', '*.body.code', 'data.code', '*.data.code'] as const`; `redactPaths(depth = 3)` returns the key-derived paths **plus** `REDACT_SCOPED_PATHS` (order: keys first).
- `apps/api/src/config/env.ts`: the `TRUST_PROXY_HOPS` doc comment reads "1 locally and on staging (the Next.js server is the only hop that terminates on the API; the TLS proxy's entry is the rightmost), 2 only when a second appending proxy is added — see docs/runbooks/staging.md". No behaviour change.
- `docs/runbooks/staging.md`, section "Client IP behind the proxies": add (a) **`WEB_BIND=0.0.0.0` caveat** — exposing `web` directly removes the TLS proxy hop, so with `TRUST_PROXY_HOPS=1` the API believes whatever `X-Forwarded-For` the browser sends; set `TRUST_PROXY_HOPS=0` in that topology and accept that `req.ip` is then the `web` container; (b) **overwrite-XFF proxies** — a proxy configured to *replace* the header (nginx `proxy_set_header X-Forwarded-For $remote_addr`) makes hop counting moot: keep `1`, and never use `$proxy_add_x_forwarded_for` *and* a hop count larger than the number of appending proxies. `docs/runbooks/local-dev.md`: a "Parallel worktrees" paragraph with the two knobs and `pnpm db:migrate:test`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/config/vitest/test-env.test.ts (keep the 3 existing cases, add)
it('TEST_DB_PREFIX and TEST_REDIS_DB_BASE drive the per-worktree names', () => {
  const env = { TEST_DB_PREFIX: 'nibras_t3', TEST_REDIS_DB_BASE: '10', DATABASE_URL_TEST: 'postgresql://u:p@h:5432/nibras_test?schema=public', REDIS_URL_TEST: 'redis://h:6379/15' };
  applyTestEnv('api', env);
  expect(env.DATABASE_URL_TEST).toBe('postgresql://u:p@h:5432/nibras_t3_api_test?schema=public'); expect(env.REDIS_URL_TEST).toBe('redis://h:6379/11');
  expect(testDbName('worker', {})).toBe('nibras_worker_test'); expect(testRedisDb('worker', {})).toBe(15);
  for (const bad of ['0', '14', 'x', '-1']) expect(() => testRedisDb('db', { TEST_REDIS_DB_BASE: bad })).toThrow(/TEST_REDIS_DB_BASE/);
});
// packages/contracts/src/redact.test.ts
it('redacts otp/verification/recovery codes and scoped body/data.code, never bare code', () => {
  const paths = redactPaths();
  expect(paths).toEqual(expect.arrayContaining(['otpCode', '*.otpCode', 'verificationCode', 'recoveryCode', 'body.code', '*.body.code', 'data.code', '*.data.code']));
  expect(paths).not.toContain('code'); expect(paths).not.toContain('*.code'); expect(REDACT_KEYS).not.toContain('code');
});
// apps/api/src/observability/logger.spec.ts and apps/worker/src/logger.test.ts (same three assertions through the real pino instance)
it('keeps err.code readable but censors otpCode and body.code', () => {
  log.info({ err: { code: 'P1001' }, otpCode: '123456', req: { body: { code: '654321' } }, job: { data: { code: 'abc' } } }, 'x');
  const line = lastLine(); expect(line.err.code).toBe('P1001'); expect(line.otpCode).toBe('[REDACTED]'); expect(line.req.body.code).toBe('[REDACTED]'); expect(line.job.data.code).toBe('[REDACTED]');
});
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm turbo run test --filter=@nibras/config --filter=@nibras/contracts --concurrency=2 && pnpm --filter @nibras/api exec vitest run src/observability/logger.spec.ts && pnpm --filter @nibras/worker exec vitest run src/logger.test.ts` — Expected: FAIL (`testDbName` undefined; `code` still redacted).

- [ ] **Step 3: Implement** — write `test-env.mjs` + `test-env.d.mts`, repoint the three vitest setup files' imports (the specifier `@nibras/config/vitest/test-env` stays), rewrite `migrate-test.mjs` on top of `testDbName`, change `redact.ts`, `turbo.json`, `.env.example`, the `env.ts` comment and the two runbooks. Verify the wrapper still works: `TEST_DB_PREFIX=nibras_t9 pnpm db:migrate:test` prints `migrating nibras_t9_db_test`, `nibras_t9_api_test`, `nibras_t9_worker_test` (then drop them).

- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/config --filter=@nibras/contracts --filter=@nibras/api --filter=@nibras/worker --concurrency=2 && pnpm turbo run e2e --dry=json --filter=@nibras/web | grep -c '"@nibras/db#build"'` — Expected: PASS; the dry run lists `@nibras/db#build` among `e2e`'s dependencies (≥ 1).

- [ ] **Step 5: Commit**

```bash
git add packages/config packages/db/scripts packages/contracts apps/api apps/worker turbo.json .env.example .github docs && git commit -m "chore: sp0 carry-overs — otp-aware redaction, single-source test db derivation with worktree knobs, e2e build ordering, proxy docs"
```

---

### Task 1: Identity & tenancy Prisma schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_identity_tenancy/migration.sql` (generated), `packages/contracts/src/consents.ts`
- Modify: `packages/contracts/src/error-codes.ts` (append the codes from Global Constraints), `packages/contracts/src/index.ts`
- Test: `packages/db/src/schema.test.ts`

**Interfaces:**
- Produces: Prisma models transcribed from PRD §11.2 and §11.7 — `User`, `UserSession`, `Workspace`, `Membership`, `TeacherStudentAssignment`, `TeacherProfile`, `Consent`, `AuditLog`, `AbuseReport` — plus two builder tables: `VerificationToken { id, userId, purpose: VerificationPurpose (EMAIL_VERIFY | PASSWORD_RESET | EMAIL_CHANGE_OLD | EMAIL_CHANGE_NEW), tokenHash @unique, payload Json?, expiresAt, usedAt?, createdAt }` and `PhoneOtp { id, userId, phoneE164, codeHash, expiresAt, attempts Int @default(0), createdAt }`. Enums from §11.1 used here: `WorkspaceType`, `WorkspaceStatus`, `PlatformRole`, `MembershipRole`, `MembershipStatus`, `UserStatus`, `AbuseCategory`, `AbuseReportStatus`, `ConsentType`, `Locale`, plus `AbuseEntityType (USER | MESSAGE | SESSION | COURSE)`. Column mapping per SP0 constraints (`@map` snake_case, `@@map` snake_case plural-free table names: `user`, `user_session`, `workspace`, `membership`, `teacher_student_assignment`, `teacher_profile`, `consent`, `audit_log`, `abuse_report`, `verification_token`, `phone_otp`). `User.email`, `Workspace.slug`, `Consent.grantedByEmail` are `@db.Citext`. Extra columns beyond §11: `Workspace.suspendedAt`, `AuditLog` has no `updatedAt` (append-only). Every §11 index and unique constraint, including the partial unique on `Consent (user_id, workspace_id, type) WHERE type = 'GUARDIAN_PARENTAL' AND revoked_at IS NULL` (added by hand to the migration SQL — Prisma cannot express it). `TENANT_MODELS = ['Membership', 'TeacherStudentAssignment', 'TeacherProfile'] as const` exported from `@nibras/db` (SP1's 🏢 tables; later plans append).
- `@nibras/contracts`: `CONSENT_VERSIONS` (values in Global Constraints), `CurrentConsentTypes = ['TERMS','PRIVACY','CODE_OF_CONDUCT','MARKETING'] as const`, `REQUIRED_CONSENTS = ['TERMS','PRIVACY'] as const`.

- [ ] **Step 1: Write the failing schema test**

```ts
// packages/db/src/schema.test.ts
describe.skipIf(!process.env.DATABASE_URL_TEST)('identity schema', () => {
  beforeEach(() => resetDatabase());
  it('email is case-insensitive unique (citext)', async () => {
    const db = systemPrisma();
    await db.user.create({ data: { email: 'ahmed@example.com', firstName: 'A', lastName: 'B' } });
    await expect(db.user.create({ data: { email: 'Ahmed@Example.COM', firstName: 'A', lastName: 'B' } })).rejects.toMatchObject({ code: 'P2002' });
  });
  it('ids are uuid v7 and timestamps default', async () => {
    const u = await systemPrisma().user.create({ data: { email: 'x@example.com', firstName: 'X', lastName: 'Y' } });
    expect(u.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/); expect(u.createdAt).toBeInstanceOf(Date);
    expect(u.locale).toBe('fr'); expect(u.timezone).toBe('Africa/Tunis'); expect(u.platformRole).toBe('NONE'); expect(u.status).toBe('ACTIVE');
  });
  it('one membership per (workspace, user) and one guardian consent per (user, workspace)', async () => { /* P2002 on duplicate membership; P2002 on second GUARDIAN_PARENTAL consent with revokedAt null, success after revoking the first */ });
  it('workspace defaults: ACTIVE, allowPersonalWorkspaces true, storageUsedBytes 0', ...);
});
```

- [ ] **Step 2: Run the test to verify it fails** — Run: `pnpm --filter @nibras/db test` (the package's `vitest.setup.ts` already applies `applyTestEnv('db', …)`, so this hits `nibras_db_test`) — Expected: FAIL (`db.user` undefined).

- [ ] **Step 3: Write the models, generate the migration, add the partial index by hand**

Run `pnpm --filter @nibras/db migrate:dev -- --name identity_tenancy --create-only`, append the partial unique index SQL to the generated `migration.sql`, then `pnpm db:migrate` (dev DB) and `pnpm db:migrate:test` (the three `*_test` DBs, or the worktree's prefixed set). Also add the new error codes and `consents.ts` to `@nibras/contracts` and rebuild it (`pnpm turbo run build --filter=@nibras/contracts --concurrency=2`).

- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run test --filter=@nibras/db --filter=@nibras/contracts --concurrency=2 && pnpm --filter @nibras/db migrate:check` — Expected: PASS; no drift.

- [ ] **Step 5: Commit**

```bash
git add packages/db packages/contracts && git commit -m "feat(db): identity and tenancy schema (user, session, workspace, membership, consent, audit, abuse report)"
```

---

### Task 2: Tenant isolation — Prisma `tenantDb` extension, RLS policies, audit append-only privileges

**Files:**
- Create: `packages/db/src/tenant.ts`, `packages/db/prisma/migrations/<ts>_rls_and_audit_privileges/migration.sql` (hand-written)
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/tenant.test.ts`

**Interfaces:**
- Produces (`@nibras/db`):
  - `class TenantContextMissingError extends Error { code = 'TENANT_CONTEXT_MISSING' as const }`.
  - `db: GuardedClient` — the `app_user` client whose query extension throws `TenantContextMissingError` for any operation on a model in `TENANT_MODELS`; use it for non-tenant tables only.
  - `tenantDb(workspaceId: string): TenantClient` — extension that, for every operation on a `TENANT_MODELS` model, (a) injects `workspaceId` into `where`/`data` (`create`, `createMany`, `update`, `updateMany`, `delete`, `deleteMany`, `findMany`, `findFirst`, `findUnique`, `count`, `aggregate`, `upsert`), rejecting `data.workspaceId` that differs → `TenantMismatchError`, and (b) runs `[ $executeRaw SELECT set_config('app.workspace_id', $wid, true), query(args) ]` in one `$transaction` batch (the Prisma RLS recipe). Non-tenant models pass through unchanged.
  - `crossTenantDb(opts?: { reason: 'super_admin' }): CrossTenantClient` — same batch mechanism setting `app.bypass_tenant = 'on'`; the extension requires `where.userId` or `where.id` to be present on tenant models (throws `CrossTenantFilterMissingError` otherwise) — this is the "always filtered by user_id" rule of §13.3. With `opts.reason = 'super_admin'` the filter check is skipped (Task 17's console aggregates are the only caller) and the caller must audit `admin.cross_tenant_query`.
  - `withTenantTx<T>(workspaceId, fn: (tx: TenantClient) => Promise<T>): Promise<T>` — interactive transaction that runs the `set_config` first, then `fn` on an extended `tx`.
  - `type PrismaLogHandler = (level: 'warn' | 'error', event: { message: string; target?: string; timestamp: Date }) => void`; `onPrismaLog(handler: PrismaLogHandler): void` — attaches `$on('warn')`/`$on('error')` on the **base** (un-extended) `app_user` client behind `db`/`tenantDb`/`crossTenantDb` and on `systemPrisma()` (`$on` is unavailable on `$extends` results, so the base client is kept in module scope). Task 5 is its only caller.
  - RLS migration: `ALTER TABLE membership ENABLE ROW LEVEL SECURITY; ALTER TABLE membership FORCE ROW LEVEL SECURITY;` (same for `teacher_student_assignment`, `teacher_profile`) and policy `tenant_isolation` `USING (workspace_id = current_setting('app.workspace_id', true)::uuid OR current_setting('app.bypass_tenant', true) = 'on') WITH CHECK (same)`; `REVOKE UPDATE, DELETE ON audit_log FROM app_user;`. Later plans copy the two statements for each new 🏢 table in their own migrations.

- [ ] **Step 1: Write the failing isolation tests**

```ts
// packages/db/src/tenant.test.ts (DB-backed; seeds two workspaces A/B each with one membership via systemPrisma())
it('AC-WS-07: raw query as app_user without app.workspace_id returns 0 rows under RLS', async () => {
  const rows = await createPrismaClient(process.env.DATABASE_URL_TEST).$queryRaw`SELECT id FROM membership`;
  expect(rows).toEqual([]);
});
it('AC-WS-07: guarded client throws TENANT_CONTEXT_MISSING on a tenant model', async () => {
  await expect(db.membership.findMany()).rejects.toBeInstanceOf(TenantContextMissingError);
});
it('tenantDb(A) only sees A even with an explicit where on B', async () => {
  expect(await tenantDb(A).membership.count()).toBe(1);
  expect(await tenantDb(A).membership.findMany({ where: { workspaceId: B } })).toEqual([]); // injected A wins (where becomes AND)
});
it('tenantDb(A) refuses to create a row for B', async () => {
  await expect(tenantDb(A).membership.create({ data: { workspaceId: B, userId: u.id, role: 'STUDENT', status: 'ACTIVE' } })).rejects.toThrow(/TenantMismatch/);
});
it('crossTenantDb requires a user filter and then sees both workspaces', async () => {
  await expect(crossTenantDb().membership.findMany()).rejects.toThrow(/CrossTenantFilterMissing/);
  expect(await crossTenantDb().membership.findMany({ where: { userId: u.id } })).toHaveLength(2);
});
it('AC-GDPR-05: app_user cannot UPDATE or DELETE audit_log', async () => {
  const row = await systemPrisma().auditLog.create({ data: { action: 'test', entityType: 'x', actorRole: 'SYSTEM', requestId: 'r' } });
  await expect(db.$executeRaw`UPDATE audit_log SET action = 'y' WHERE id = ${row.id}::uuid`).rejects.toThrow(/permission denied/);
  await expect(db.$executeRaw`DELETE FROM audit_log WHERE id = ${row.id}::uuid`).rejects.toThrow(/permission denied/);
  await expect(db.auditLog.create({ data: { action: 'ok', entityType: 'x', actorRole: 'SYSTEM', requestId: 'r' } })).resolves.toBeTruthy();
});
it('withTenantTx rolls back atomically', ...);
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/db test` — Expected: FAIL.

- [ ] **Step 3: Implement `tenant.ts` and write the RLS migration** — `pnpm --filter @nibras/db migrate:dev -- --name rls_and_audit_privileges --create-only`, replace the empty `migration.sql` with the hand-written statements, then `pnpm db:migrate && pnpm db:migrate:test`.

- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm --filter @nibras/db test && pnpm --filter @nibras/db migrate:check` — Expected: PASS; no drift.

- [ ] **Step 5: Commit**

```bash
git add packages/db && git commit -m "feat(db): tenant-scoped prisma extension, postgres rls policies and append-only audit log"
```

---

### Task 3: `packages/providers` — EmailProvider (SMTP + in-memory), SmsProvider (log + in-memory), FR/AR/EN templates

**Files:**
- Create: `packages/providers/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/email/types.ts`, `src/email/smtp.ts`, `src/email/in-memory.ts`, `src/email/templates/layout.ts`, `src/email/templates/index.ts`, `src/sms/types.ts`, `src/sms/log.ts`, `src/sms/in-memory.ts`
- Modify: `packages/i18n/messages/{fr,ar,en}.json` (namespace `emails`)
- Test: `packages/providers/src/email/templates.test.ts`, `packages/providers/src/email/smtp.test.ts`

**Interfaces:**
- Produces (`@nibras/providers`):
  - `interface EmailProvider { send(msg: { to: string; templateKey: EmailTemplateKey; locale: Locale; params: Record<string, string | number>; ics?: string }): Promise<{ providerMessageId: string }> }` (PRD §13.4; `verifyWebhook` is SP7).
  - `EmailTemplateKey` union: `auth.verify_email`, `auth.password_reset`, `auth.email_change_confirm`, `security.password_changed`, `security.email_changed`, `security.new_device`, `security.token_reuse`, `security.account_locked`, `security.2fa_enabled`, `security.2fa_disabled`, `security.recovery_code_used`, `phone.otp_dev`, `workspace.ownership_transferred`, `abuse.report_received`, `abuse.new_report`, `abuse.minor_safety_reminder`, `admin.user_suspended`, `admin.user_unsuspended`.
  - `renderEmail(key, locale, params): { subject: string; html: string; text: string }` — subject/body from `@nibras/i18n` `emails.<key>.{subject,title,body,cta}` with ICU interpolation; `layout(locale, { title, bodyHtml, cta? })` emits `<html lang="{locale}" dir="{dirOf(locale)}">` (`dirOf`, `LOCALES`, `Locale` from `@nibras/contracts`), the app name and a legal footer line (`emails.footer.legal`). Params carrying one-time codes are named `otpCode` (`phone.otp_dev { otpCode }`) — Global Constraints naming rule.
  - `SmtpEmailProvider(opts: { smtpUrl: string; from: string })` (nodemailer), `InMemoryEmailProvider` with `sent: SentEmail[]`, `last(to?: string)`, `findByTemplate(key, to?)`, `clear()`.
  - `interface SmsProvider { send(msg: { to: string; templateKey: 'phone.otp'; locale: Locale; params: { otpCode: string } }): Promise<{ providerMessageId: string }> }`; `LogSmsProvider(logger)` (selected by `SMS_PROVIDER=console`, the value `.env.example` and CI already carry; it logs `{ to, templateKey, locale }` at info and the `otpCode` only at debug — redacted by `REDACT_KEYS` anyway), `InMemorySmsProvider` with `sent`, `last(to?)`, `clear()`.
  - `extractFirstLink(html: string, pathContains: string): string | null` (test helper used by API tests and Playwright).

- [ ] **Step 1: Write the failing tests**

```ts
// templates.test.ts
it('renders every template key in every locale with no missing ICU argument', () => {
  for (const key of EMAIL_TEMPLATE_KEYS) for (const locale of LOCALES) {
    const out = renderEmail(key, locale, SAMPLE_PARAMS[key]);
    expect(out.subject.length).toBeGreaterThan(3); expect(out.html).toContain(`lang="${locale}"`); expect(out.text).not.toMatch(/\{\w+\}/);
  }
});
it('Arabic emails are RTL with an Arabic subject', () => {
  const out = renderEmail('auth.verify_email', 'ar', { firstName: 'أحمد', link: 'https://x/verify?token=t' });
  expect(out.html).toContain('dir="rtl"'); expect(out.subject).toMatch(/[؀-ۿ]/);
});
it('verify_email French subject and link', () => {
  const out = renderEmail('auth.verify_email', 'fr', { firstName: 'Mohamed', link: 'https://x/fr/verify-email?token=abc' });
  expect(out.subject).toBe('Vérifiez votre email'); expect(extractFirstLink(out.html, '/verify-email')).toBe('https://x/fr/verify-email?token=abc');
});
// smtp.test.ts (skipIf no SMTP_URL): send to Mailpit then GET http://localhost:8025/api/v1/search?query=to:probe@example.com → 1 message
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/providers test` — Expected: FAIL.

- [ ] **Step 3: Implement providers and the `emails` messages in the three catalogues** — the i18n parity test from SP0 enforces that `ar`/`en` get every new key.

- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run test --filter=@nibras/providers --filter=@nibras/i18n --concurrency=2` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/providers packages/i18n && git commit -m "feat(providers): email (smtp, in-memory) and sms (log, in-memory) providers with fr/ar/en templates"
```

---

### Task 4: Security primitives — argon2id, password policy with common list + HIBP, opaque tokens, secret box

**Files:**
- Create: `apps/api/src/auth/crypto/password.ts`, `password-policy.ts`, `common-passwords.txt` (SecLists top 10 000), `hibp.ts`, `tokens.ts`, `secret-box.ts`
- Test: `apps/api/src/auth/crypto/{password,password-policy,tokens,secret-box}.spec.ts`

**Interfaces:**
- Produces: `hashPassword(plain): Promise<string>` (argon2id, memory 64 MiB, time 3, parallelism 1), `verifyPassword(hash, plain): Promise<boolean>`; `interface PwnedPasswordClient { isPwned(plain: string): Promise<boolean> }`, `HibpClient` (k-anonymity: SHA-1, GET `https://api.pwnedpasswords.com/range/{first5}` with `Add-Padding: true`, 3 s timeout; on network error returns `false` and logs a warning — fail-open, planner ruling), `FakePwnedClient(set: string[])`; `PasswordPolicy(client).validate(plain): Promise<{ ok: true } | { ok: false; code: 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_COMMON' | 'PASSWORD_COMPROMISED' }>` (min 12, max 256, common list lookup after NFKC + lowercase, then HIBP); `generateToken(): { raw: string; hash: string }` (32 random bytes → base64url, `hash = sha256(raw)` hex), `hashToken(raw)`, `safeEqual(a, b)` (timing-safe); `SecretBox(keyBase64: string)` with `seal(plain): string` (`v1.` + iv + ciphertext + tag, AES-256-GCM) and `open(sealed): string`.

- [ ] **Step 1: Write the failing unit tests**

```ts
it('argon2id hash verifies and is salted', async () => { const h = await hashPassword('correct horse battery staple'); expect(h).toMatch(/^\$argon2id\$/); expect(await verifyPassword(h, 'correct horse battery staple')).toBe(true); expect(await verifyPassword(h, 'nope')).toBe(false); expect(h).not.toBe(await hashPassword('correct horse battery staple')); });
it('policy: too short, too common, compromised, ok', async () => {
  const p = new PasswordPolicy(new FakePwnedClient(['Tr0ub4dor&3xyz99']));
  expect(await p.validate('short')).toEqual({ ok: false, code: 'PASSWORD_TOO_SHORT' });
  expect(await p.validate('password1234')).toEqual({ ok: false, code: 'PASSWORD_TOO_COMMON' });
  expect(await p.validate('Tr0ub4dor&3xyz99')).toEqual({ ok: false, code: 'PASSWORD_COMPROMISED' });
  expect(await p.validate('un mot de passe assez long')).toEqual({ ok: true });
});
it('tokens: 43-char base64url raw, 64-hex hash, safeEqual constant-time API', ...);
it('secret box round-trips and rejects tampering', () => { const b = new SecretBox(KEY); const s = b.seal('JBSWY3DPEHPK3PXP'); expect(b.open(s)).toBe('JBSWY3DPEHPK3PXP'); expect(() => b.open(s.slice(0, -2) + 'AA')).toThrow(); });
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/api exec vitest run src/auth/crypto` — Expected: FAIL.
- [ ] **Step 3: Implement the five files** (download the SecLists `10-million-password-list-top-10000.txt` into `common-passwords.txt`; load once, lowercase set). `argon2` installs a native binary through an install script that pnpm 10 blocks by default: add `argon2` to `onlyBuiltDependencies` in `pnpm-workspace.yaml` (the list lives there, not in `package.json`) and confirm `pnpm install` prints no "Ignored build scripts: argon2" warning and `node -e "require('argon2')"` loads inside `apps/api`.
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm --filter @nibras/api exec vitest run src/auth/crypto` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add apps/api/src/auth/crypto apps/api/package.json pnpm-workspace.yaml pnpm-lock.yaml && git commit -m "feat(api): password hashing, password policy with hibp, opaque tokens and secret box"`

---

### Task 5: API infrastructure for SP1 — request context, AuditService, QueueService, providers module, DbModule (Prisma logs → pino), metrics middleware, type-aware lint, extended test app

**Files:**
- Modify: `apps/api/src/common/request-context.ts`, `apps/api/src/config/env.ts` (+ `env.spec.ts`), `apps/api/src/app.module.ts`, `apps/api/src/observability/observability.module.ts`, `apps/api/test/helpers/app.ts`, `apps/api/test/observability.e2e-spec.ts`, `packages/config/eslint/nest.mjs`
- Create: `apps/api/src/audit/{audit.module,audit.service}.ts`, `apps/api/src/queue/{queue.module,queue.service}.ts`, `apps/api/src/providers/providers.module.ts`, `apps/api/src/db/{db.module,prisma-logs}.ts`, `apps/api/src/observability/metrics.middleware.ts`, `apps/api/test/helpers/factories.ts`
- Delete: `apps/api/src/observability/metrics.interceptor.ts`
- Test: `apps/api/src/audit/audit.service.spec.ts`, `apps/api/src/db/prisma-logs.spec.ts`, `apps/api/src/config/env.spec.ts`, `apps/api/test/observability.e2e-spec.ts`, `apps/api/test/infra.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `RequestStore` (SP0's interface in `request-context.ts`) gains: `user?: AuthUser; session?: { id: string; familyId: string }; workspace?: { id; type: WorkspaceType; status: WorkspaceStatus }; membership?: { id; role: MembershipRole; canTeach: boolean; status: MembershipStatus }; permissionScope?: 'all' | 'own'`; `type AuthUser = Pick<User, 'id' | 'email' | 'status' | 'platformRole' | 'locale' | 'timezone' | 'emailVerifiedAt' | 'phoneVerifiedAt' | 'totpEnabledAt' | 'firstName' | 'lastName'>`. `RequestContext.get()/run()` are unchanged; guards mutate the store returned by `get()`.
  - `DbModule` (`@Global()`): provides `DB` token = `db` (`GuardedClient` from `@nibras/db`); `onModuleInit` calls `onPrismaLog(forwardPrismaLogs(logger))` where `forwardPrismaLogs(logger: PinoLogger): PrismaLogHandler` (`prisma-logs.ts`) maps `warn` → `logger.warn({ target, source: 'prisma' }, message)` and `error` → `logger.error(...)`. Fixes SP0 FIX-LATER "prisma warn/error log events have no default listener".
  - `MetricsMiddleware` (`NestMiddleware`, applied in `AppModule.configure` to `{*path}` right after `RequestIdMiddleware`): starts `httpRequestDuration` timer and samples on `res.once('close')` with `route = req.route?.path ? req.baseUrl + req.route.path : 'unknown'` resolved **at close time**; replaces `MetricsInterceptor` (removed from `ObservabilityModule`) so rejections before the handler — unknown routes, body parsing, Task 7's guards' 401/403 — are measured.
  - env: `REDIS_URL: z.url().refine((u) => /^rediss?:$/.test(new URL(u).protocol), 'REDIS_URL must use redis: or rediss:')`.
  - `packages/config/eslint/nest.mjs` (api + worker only): add `languageOptions: { parserOptions: { projectService: true } }` (each package runs `eslint .` from its own directory, so the project service finds its `tsconfig.json` without `tsconfigRootDir`) and the rules `'@typescript-eslint/no-floating-promises': 'error'`, `'@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }]`; `.mjs`/`.spec.ts` files stay covered by the package tsconfig or are added to `allowDefaultProject`. Both apps must lint clean before the async-heavy services of Tasks 6–17 land.
  - `AuditService.log(entry: { action: AuditAction; entityType: string; entityId?: string; workspaceId?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; actorOverride?: { userId?: string; role: string } }): Promise<void>` — fills `actorUserId`, `actorRole` (`membership.role` if in a workspace, else `platformRole` or `'USER'`, `'SYSTEM'` for jobs), `ip`, `userAgent`, `requestId` from the context; strips keys matching `/hash|secret|password|token/i` from before/after; writes with `db.auditLog.create`; never throws to the caller (logs at error level). `AuditAction` is a string union listed in `audit.service.ts` (the actions named in Tasks 6–17).
  - `AuditService.log(entry: { action: AuditAction; entityType: string; entityId?: string; workspaceId?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; actorOverride?: { userId?: string; role: string } }): Promise<void>` — fills `actorUserId`, `actorRole` (`membership.role` if in a workspace, else `platformRole` or `'USER'`, `'SYSTEM'` for jobs), `ip`, `userAgent`, `requestId` from the context; strips keys matching `/hash|secret|password|token/i` from before/after; writes with `db.auditLog.create`; never throws to the caller (logs at error level). `AuditAction` is a string union listed in `audit.service.ts` (the actions named in Tasks 6–17).
  - `QueueService.add(queue: QueueName, name: string, data: unknown, opts?: JobsOptions): Promise<void>` over `@nestjs/bullmq` queues registered for every `QUEUES` entry with `defaultJobOptions: DEFAULT_JOB_OPTIONS` (from `@nibras/contracts`) and the connection parsed from `env.REDIS_URL`; `FakeQueueService` records `{ queue, name, data, opts }` in `jobs[]`.
  - `ProvidersModule` exporting `EMAIL_PROVIDER` (SMTP from `SMTP_URL`/`EMAIL_FROM`) and `SMS_PROVIDER` (`LogSmsProvider` when `SMS_PROVIDER=console`).
  - env additions (`EnvSchema`): `JWT_SECRET: z.string().min(32)`, `TOTP_ENCRYPTION_KEY: z.string().refine(b64 decodes to exactly 32 bytes)`, `SMTP_URL: z.url()`, `EMAIL_FROM: z.string().min(3)`, `SMS_PROVIDER: z.enum(['console']).default('console')`, `HIBP_ENABLED: z.stringbool().default(true)`, `COOKIE_SECURE: z.stringbool().default(NODE_ENV === 'production')` (zod 4 `stringbool` parses `'true'/'false'`). All seven are **already listed** in `turbo.json` `test.env`, CI `env` and `.env.example` (dev values: `JWT_SECRET=dev-only-jwt-secret-change-me-0123456789abcdef`, `TOTP_ENCRYPTION_KEY=ZGV2LW9ubHktdG90cC1rZXktMzItYnl0ZXMtbG9uZyE=` = 32 bytes, `SMS_PROVIDER=console`, `HIBP_ENABLED=false`, `COOKIE_SECURE=false`) — do not re-add; extend all three places only if you introduce another variable.
  - `createTestApp(opts?)` keeps SP0's options (`overrides`, `controllers`) and return fields (`app`, `http`, `logs`) and adds `db: PrismaClient /* systemPrisma() on nibras_api_test */, email: InMemoryEmailProvider, sms: InMemorySmsProvider, queue: FakeQueueService, pwned: FakePwnedClient, reset(): Promise<void>` with the four overrides applied by default (`opts.overrides` runs after them and may replace any); `reset()` = `resetDatabase(db)` + `clear()` on `email`/`sms`/`queue`/`pwned`/`logs`. Specs call `beforeEach(() => ctx.reset())`; `test/setup.ts` is unchanged (SP0's specs need no DB reset). `type TestContext = Awaited<ReturnType<typeof createTestApp>>`.
  - Factories (`test/helpers/factories.ts`, write through `systemPrisma()`): `createUser(o?: Partial<{ email; password; firstName; lastName; locale; timezone; emailVerified: boolean; phoneVerified: boolean; platformRole; status; totpSecret }>): Promise<User & { password: string }>` (default verified email, password `'correct horse battery staple'`), `createPersonalWorkspace(owner: User, o?): Promise<Workspace>` (OWNER membership + settings defaults), `createOrganization(o: { owner: User; admins?: User[]; teachers?: User[]; students?: User[]; allowPersonalWorkspaces?: boolean }): Promise<{ workspace: Workspace; memberships: Membership[] }>`, `grantConsents(user, types = ['TERMS','PRIVACY'])`.

- [ ] **Step 1: Write the failing tests**

```ts
// audit.service.spec.ts — AuditService with a mocked db; RequestContext.run({...user, ip:'1.2.3.4', userAgent:'UA', requestId:'r1'}, () => audit.log({ action:'member.role_changed', entityType:'Membership', entityId:m, workspaceId:w, before:{ role:'TEACHER', passwordHash:'x' }, after:{ role:'ADMIN' } }))
expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorUserId: user.id, actorRole: 'OWNER', ip: '1.2.3.4', userAgent: 'UA', requestId: 'r1', before: { role: 'TEACHER' } }) });
// prisma-logs.spec.ts
it('forwards prisma warn/error events to pino with source and target', () => {
  const logger = { warn: vi.fn(), error: vi.fn() }; const h = forwardPrismaLogs(logger as never);
  h('warn', { message: 'slow query', target: 'quaint::pooled', timestamp: new Date() }); h('error', { message: 'P1001', timestamp: new Date() });
  expect(logger.warn).toHaveBeenCalledWith({ source: 'prisma', target: 'quaint::pooled' }, 'slow query'); expect(logger.error).toHaveBeenCalledWith({ source: 'prisma', target: undefined }, 'P1001');
});
// env.spec.ts (+)
it('rejects REDIS_URL that is not redis:/rediss:', () => { for (const bad of ['http://localhost:6379', 'postgresql://x']) expect(() => EnvSchema.parse({ ...valid, REDIS_URL: bad })).toThrow(/redis:/); expect(EnvSchema.parse({ ...valid, REDIS_URL: 'rediss://h:6380/2' }).REDIS_URL).toBe('rediss://h:6380/2'); });
// observability.e2e-spec.ts (+) — a test-only controller mounted via createTestApp({ controllers: [GuardedProbeController] }) whose guard throws new ApiError(401, 'UNAUTHENTICATED', 'nope')
it('requests rejected by a guard or by routing are measured', async () => {
  await http.get('/api/v1/__test/guarded').expect(401); await http.get('/api/v1/nope').expect(404);
  const metrics = (await http.get('/metrics').expect(200)).text;
  expect(metrics).toMatch(/http_request_duration_seconds_count\{[^}]*route="\/api\/v1\/__test\/guarded"[^}]*status="401"/); expect(metrics).toMatch(/route="unknown"[^}]*status="404"/);
});
// infra.e2e-spec.ts
it('test app boots with fakes and factories create a verified user and an organization', async () => {
  const { email, queue, db } = ctx; const owner = await createUser(); const { workspace, memberships } = await createOrganization({ owner, teachers: [await createUser()], students: [await createUser(), await createUser()] });
  expect(memberships).toHaveLength(4); expect(workspace.type).toBe('ORGANIZATION'); expect(email.sent).toEqual([]); expect(queue.jobs).toEqual([]);
  expect(new URL(process.env.DATABASE_URL!).pathname).toMatch(/_api_test$/); // per-package / per-worktree DB, never nibras
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/api test` — Expected: FAIL.
- [ ] **Step 3: Implement** — `AuditModule`, `QueueModule`, `ProvidersModule`, `DbModule` are `@Global()`; delete `metrics.interceptor.ts`; add the two lint rules and fix every finding in `apps/api` and `apps/worker` (expected: a handful of un-awaited `app.close()`/`logger.flush()` calls in specs — fix them with `await` or `void`, never by disabling the rule).
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/api --filter=@nibras/worker --filter=@nibras/config --concurrency=2` — Expected: PASS (SP0 tests still green; lint clean under the type-aware rules).
- [ ] **Step 5: Commit** — `git add apps/api apps/worker packages/config && git commit -m "feat(api): request context, audit service, queue service, providers module, prisma logs to pino, metrics middleware, type-aware lint and test factories"`

---

### Task 6: Teacher registration, email verification, unverified gate (AC-AUTH-01, AC-AUTH-02)

**Files:**
- Create: `apps/api/src/auth/{auth.module,auth.controller,register.service}.ts`, `apps/api/src/auth/decorators/{public,allow-unverified,current-user}.ts`, `apps/api/src/auth/dto.ts`, `packages/contracts/src/auth.ts`, `apps/api/src/workspaces/slug.ts`
- Test: `apps/api/test/auth/register.e2e-spec.ts`, `apps/api/src/workspaces/slug.spec.ts`

**Interfaces:**
- Produces:
  - `@nibras/contracts` `RegisterTeacherSchema = z.object({ kind: z.literal('TEACHER'), firstName: z.string().trim().min(1).max(80), lastName: same, email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(12).max(256), locale: LocaleSchema, timezone: TimezoneSchema, acceptTerms: z.literal(true), acceptPrivacy: z.literal(true) })`; `TimezoneSchema = z.string().refine(isValidTimeZone)` with `isValidTimeZone(tz) = tz === 'UTC' || Intl.supportedValuesOf('timeZone').includes(tz)`; `BirthDateSchema` (ISO date, `>= 1900-01-01`, `<= today`). SP2 extends `kind` with `'INVITED'`.
  - `RegisterService.registerTeacher(input, ctx: { ip; userAgent }): Promise<{ user: User; workspace: Workspace }>` — in one transaction: User (status ACTIVE, locale, timezone), Workspace PERSONAL (`name = "Espace de {firstName}"`, `slug = slugify(name)-{6}`, `defaultTimezone = timezone`, `defaultLocale = locale`, `storageQuotaBytes = 20 GiB`, `settings` = defaults of Task 14), Membership OWNER ACTIVE `joinedAt = now`, Consents TERMS + PRIVACY at `CONSENT_VERSIONS` with ip/ua; then a `VerificationToken EMAIL_VERIFY` (24 h) and `auth.verify_email` email with link `${WEB_ORIGIN}/${locale}/verify-email?token=${raw}`; audit `auth.registered`; emits `TeacherRegisteredEvent` (event-emitter) for SP10 analytics. Existing email → `409 EMAIL_TAKEN` (planner ruling: registration may reveal existence; reset must not).
  - `POST /auth/register` (public) → `201 { user: MeUser }` and sets the auth cookies (session creation comes from Task 7's `SessionService`; until Task 7 lands, the controller returns 201 without cookies and Task 7 wires them — note this in the commit).
  - `POST /auth/verify-email { token }` (public) → `200 { ok: true }`; sets `emailVerifiedAt`, marks token used; used/expired/unknown → `410 TOKEN_INVALID`.
  - `POST /auth/resend-verification` (auth, `@AllowUnverified()`) → invalidates earlier tokens, new email; > 1 per minute per user → `429 RATE_LIMITED`.
  - Decorators: `@Public()` (skip JWT), `@AllowUnverified()` (skip account gates), `@CurrentUser()` param decorator.
  - `slugify(input: string): string` (NFKD, strip diacritics, `[^a-z0-9]+` → `-`, trim `-`, max 48) and `uniqueSlug(base): string` (`base-xxxxxx`).

- [ ] **Step 1: Write the failing tests**

```ts
// register.e2e-spec.ts
const body = { kind: 'TEACHER', firstName: 'Mohamed', lastName: 'Sfaxi', email: 'mohamed@example.com', password: 'un mot de passe assez long', locale: 'fr', timezone: 'Africa/Tunis', acceptTerms: true, acceptPrivacy: true };
it('AC-AUTH-01: creates user, PERSONAL workspace as OWNER, consents and a verification email', async () => {
  const res = await http.post('/api/v1/auth/register').send(body).expect(201);
  const user = await db.user.findUniqueOrThrow({ where: { email: 'mohamed@example.com' }, include: { memberships: { include: { workspace: true } }, consents: true } });
  expect(user.emailVerifiedAt).toBeNull(); expect(user.passwordHash).toMatch(/^\$argon2id\$/);
  expect(user.memberships).toHaveLength(1); expect(user.memberships[0]).toMatchObject({ role: 'OWNER', status: 'ACTIVE' });
  expect(user.memberships[0].workspace).toMatchObject({ type: 'PERSONAL', name: 'Espace de Mohamed', defaultTimezone: 'Africa/Tunis', storageQuotaBytes: 20n * 1024n ** 3n });
  expect(user.memberships[0].workspace.slug).toMatch(/^espace-de-mohamed-[a-z2-7]{6}$/);
  expect(user.consents.map((c) => [c.type, c.version, c.granted])).toEqual(expect.arrayContaining([['TERMS', 'terms-2026-10', true], ['PRIVACY', 'privacy-2026-10', true]]));
  const mail = email.findByTemplate('auth.verify_email', 'mohamed@example.com'); expect(mail?.locale).toBe('fr'); expect(extractFirstLink(mail!.html, '/fr/verify-email?token=')).toBeTruthy();
  expect(await db.auditLog.count({ where: { action: 'auth.registered', entityId: user.id } })).toBe(1);
});
it('AC-AUTH-02: compromised password is refused without naming the source', async () => {
  pwned.add('un mot de passe compromis'); const res = await http.post('/api/v1/auth/register').send({ ...body, password: 'un mot de passe compromis' }).expect(422);
  expect(res.body.code).toBe('PASSWORD_COMPROMISED'); expect(JSON.stringify(res.body)).not.toMatch(/hibp|pwned|haveibeenpwned/i);
});
it('rejects short and common passwords with their codes', ...); // 'short' → PASSWORD_TOO_SHORT (422), 'password1234' → PASSWORD_TOO_COMMON
it('normalises email: trims and lowercases; duplicate differing by case is 409 EMAIL_TAKEN', async () => {
  await http.post('/api/v1/auth/register').send({ ...body, email: '  Mohamed@Example.com ' }).expect(201);
  expect(await db.user.count({ where: { email: 'mohamed@example.com' } })).toBe(1);
  await http.post('/api/v1/auth/register').send({ ...body, email: 'MOHAMED@example.com' }).expect(409).expect(({ body }) => expect(body.code).toBe('EMAIL_TAKEN'));
});
it('rejects invalid timezone and locale with 422 VALIDATION_FAILED', async () => {
  for (const patch of [{ timezone: 'Europe/Tunis' }, { locale: 'de' }, { acceptTerms: false }]) {
    const res = await http.post('/api/v1/auth/register').send({ ...body, ...patch }).expect(422); expect(res.body.code).toBe('VALIDATION_FAILED');
  }
});
it('verify-email marks the user verified once; second use and expired tokens are 410 TOKEN_INVALID', async () => {
  await http.post('/api/v1/auth/register').send(body).expect(201);
  const token = new URL(extractFirstLink(email.last()!.html, '/verify-email')!).searchParams.get('token')!;
  await http.post('/api/v1/auth/verify-email').send({ token }).expect(200);
  expect((await db.user.findUniqueOrThrow({ where: { email: body.email } })).emailVerifiedAt).toBeInstanceOf(Date);
  await http.post('/api/v1/auth/verify-email').send({ token }).expect(410).expect(({ body }) => expect(body.code).toBe('TOKEN_INVALID'));
  // expired: create a VerificationToken with expiresAt in the past via db → 410
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/api exec vitest run test/auth/register` — Expected: FAIL.
- [ ] **Step 3: Implement** — `AuthModule` imports `AuditModule`, `ProvidersModule`; the password policy uses `HibpClient` when `HIBP_ENABLED` else `FakePwnedClient([])` (tests inject their own).
- [ ] **Step 4: Run to verify pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(auth): teacher registration with personal workspace, consents and email verification"`

---

### Task 7: Login, JWT sessions, refresh rotation with reuse detection, device list (AC-AUTH-04, AC-AUTH-07)

**Files:**
- Create: `apps/api/src/auth/{session.service,jwt.service,auth.service}.ts`, `apps/api/src/auth/guards/{jwt-auth.guard,account-gates.guard}.ts`, `apps/api/test/helpers/auth.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`, `apps/api/src/app.module.ts` (global guards `APP_GUARD`: `JwtAuthGuard`, `AccountGatesGuard`), `packages/contracts/src/auth.ts`
- Test: `apps/api/test/auth/login.e2e-spec.ts`, `apps/api/test/auth/sessions.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `JwtService.signAccess({ sub, sid }): Promise<string>` (jose HS256, `typ: 'access'`, 15 min), `signChallenge({ sub, jti }): Promise<string>` (`typ: '2fa'`, 5 min), `verify(token, expectedTyp): Promise<Payload>` → throws on wrong `typ`.
  - `SessionService.createSession(user: User, meta: { ip; userAgent; remember: boolean }): Promise<{ session: UserSession; accessToken: string; refreshToken: string }>` — refresh token = `${session.id}.${raw}` stored as `refreshTokenHash = sha256(raw)`, `familyId = session.id`, `deviceLabel` derived from the user-agent (browser + OS), `expiresAt = now + 30 d`; `rotate(refreshToken, meta): Promise<same | 'REUSE'>` — looks up by `sid`; hash match → new raw + hash, `lastSeenAt`; mismatch or revoked → revoke the whole family, email `security.token_reuse`, audit `auth.refresh_reuse_detected`, return `'REUSE'`; `revoke(sessionId)`, `revokeAll(userId, except?: sessionId)`; `listActive(userId): Promise<SessionSummary[]>` (`{ id, deviceLabel, ip, createdAt, lastSeenAt, current: boolean }`).
  - `AuthService.login({ email, password, remember }, meta): Promise<{ status: 'OK'; user; tokens } | { status: 'TWO_FACTOR_REQUIRED'; challengeToken: string }>` — unknown email or bad password → `401 INVALID_CREDENTIALS` (same timing: always run argon2 verify against a dummy hash when the user is missing); suspended → `403 ACCOUNT_SUSPENDED`; audits `auth.login` / `auth.login_failed` (entityId = user id if known, else `email` sha256 in `after`); new device (no non-revoked session with the same `deviceLabel`) → email `security.new_device`; sets `lastLoginAt`. The 2FA branch is wired in Task 10 (Task 7 returns `'OK'` always).
  - Cookies: `nibras_access` (path `/`, maxAge 15 min) and `nibras_refresh` (path `/api/v1/auth`, maxAge 30 d when `remember`, session cookie otherwise), both `httpOnly`, `sameSite: 'lax'`, `secure: env.COOKIE_SECURE`. `Authorization: Bearer <access>` is accepted too.
  - `JwtAuthGuard` (global; skipped by `@Public()`): reads cookie or bearer, verifies `typ: 'access'`, loads `UserSession` (must be unrevoked and unexpired) **and** `User` in one query, puts `user`/`session` in `RequestContext`; failures → `throw new ApiError(401, 'UNAUTHENTICATED', …)` / `new ApiError(401, 'SESSION_REVOKED', …)` (a bare `UnauthorizedException` would lose the `SESSION_REVOKED` code — the filter maps by status). Same rule for every 403 below (`ACCOUNT_SUSPENDED`, `EMAIL_NOT_VERIFIED`, `CONSENT_REQUIRED`, `TWO_FACTOR_SETUP_REQUIRED`). Guard rejections are visible in `/metrics` through Task 5's middleware.
  - `AccountGatesGuard` (global; skipped by `@Public()` and `@AllowUnverified()`), in order: `user.status === 'SUSPENDED'` → `403 ACCOUNT_SUSPENDED`; `emailVerifiedAt == null` → `403 EMAIL_NOT_VERIFIED`; pending consents (Task 11) → `403 CONSENT_REQUIRED` with `details.pending`; 2FA setup required (Task 10) → `403 TWO_FACTOR_SETUP_REQUIRED`. Tasks 10/11 plug their checks into this guard.
  - Endpoints: `POST /auth/login { email, password, remember? }` (public) → `200 { status: 'OK', user }` + cookies; `POST /auth/refresh` (public, reads `nibras_refresh`) → `200` + new cookies, `401 SESSION_REVOKED` on reuse; `POST /auth/logout` (`@AllowUnverified`) → revokes current session, clears cookies; `GET /auth/sessions` → `SessionSummary[]`; `DELETE /auth/sessions/{id}`; `DELETE /auth/sessions` (all, including current → clears cookies; audit `auth.sessions_revoked`).
  - Test helper `loginAs(ctx, user, opts?: { remember?: boolean }): Promise<{ cookie: string; sessionId: string; accessToken: string }>` (creates a session directly through `SessionService`, returns a `Cookie` header value) and `as(http, cookie)` returning an agent with the cookie preset.

- [ ] **Step 1: Write the failing tests**

```ts
// login.e2e-spec.ts
it('logs in with cookies and audits; wrong password is 401 INVALID_CREDENTIALS and audited', async () => {
  const u = await createUser({ email: 'ahmed@example.com' });
  const res = await http.post('/api/v1/auth/login').send({ email: 'Ahmed@Example.com', password: u.password }).expect(200);
  expect(res.headers['set-cookie'].join(';')).toMatch(/nibras_access=.*HttpOnly/); expect(res.body.status).toBe('OK');
  await http.post('/api/v1/auth/login').send({ email: u.email, password: 'wrong wrong wrong' }).expect(401).expect(({ body }) => expect(body.code).toBe('INVALID_CREDENTIALS'));
  expect(await db.auditLog.count({ where: { action: 'auth.login_failed' } })).toBe(1);
});
it('unknown email is also 401 INVALID_CREDENTIALS (no enumeration)', ...);
it('suspended user cannot log in (403 ACCOUNT_SUSPENDED)', ...);
it('new device triggers security.new_device email; same device does not', ...);
it('remember=false yields a session cookie without Max-Age; remember=true yields Max-Age=2592000', ...);
// sessions.e2e-spec.ts
it('AC-AUTH-04: refresh rotates; replaying the old refresh token revokes the family and emails the user', async () => {
  const u = await createUser(); const login = await http.post('/api/v1/auth/login').send({ email: u.email, password: u.password });
  const refresh1 = cookieValue(login, 'nibras_refresh');
  const r2 = await http.post('/api/v1/auth/refresh').set('Cookie', `nibras_refresh=${refresh1}`).expect(200);
  const refresh2 = cookieValue(r2, 'nibras_refresh'); expect(refresh2).not.toBe(refresh1);
  await http.post('/api/v1/auth/refresh').set('Cookie', `nibras_refresh=${refresh1}`).expect(401).expect(({ body }) => expect(body.code).toBe('SESSION_REVOKED'));
  await http.post('/api/v1/auth/refresh').set('Cookie', `nibras_refresh=${refresh2}`).expect(401); // whole family dead
  expect(email.findByTemplate('security.token_reuse', u.email)).toBeTruthy();
  await http.get('/api/v1/me').set('Cookie', `nibras_access=${cookieValue(r2, 'nibras_access')}`).expect(401);
});
it('AC-AUTH-07: "Déconnecter partout" revokes 3 sessions immediately and lists them as revoked', async () => {
  const u = await createUser(); const s = await Promise.all([1, 2, 3].map(() => loginAs(ctx, u)));
  expect((await as(http, s[0].cookie).get('/api/v1/auth/sessions').expect(200)).body).toHaveLength(3);
  await as(http, s[0].cookie).delete('/api/v1/auth/sessions').expect(204);
  for (const x of s) await as(http, x.cookie).get('/api/v1/me').expect(401).expect(({ body }) => expect(body.code).toBe('SESSION_REVOKED'));
  expect(await db.userSession.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
});
it('DELETE /auth/sessions/{id} of another user is 404', ...);
it('a 2fa-typed token is rejected as access token (401)', ...); // sign with JwtService.signChallenge, call GET /me
```

(`GET /api/v1/me` is a placeholder here returning `{ user }` with `@AllowUnverified()`; Task 11 replaces it.)

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement** — also make `POST /auth/register` set cookies via `SessionService` (closing Task 6's note).
- [ ] **Step 4: Run to verify pass** — `pnpm --filter @nibras/api test` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(auth): login, jwt sessions with rotating refresh tokens, reuse detection and device management"`

---

### Task 8: Login throttling, account lockout and global rate limits (AC-AUTH-03)

**Files:**
- Create: `apps/api/src/auth/login-throttle.service.ts`, `apps/api/src/common/rate-limit.module.ts`
- Modify: `apps/api/src/auth/auth.service.ts`, `apps/api/src/app.module.ts`
- Test: `apps/api/src/auth/login-throttle.service.spec.ts`, `apps/api/test/auth/throttle.e2e-spec.ts`

**Interfaces:**
- Produces: `LoginThrottleService` (injects SP0's `REDIS` ioredis token from `apps/api/src/redis/redis.module.ts`): `check(email, ip): Promise<{ allowed: true } | { allowed: false; code: 'RATE_LIMITED' | 'ACCOUNT_LOCKED'; retryAfterS: number }>`, `recordFailure(email, ip, user?: User): Promise<void>`, `reset(email, ip)`. Keys: `login:fail:{sha256(email)}:{ip}` (window 60 s; from the 6th attempt `retryAfterS = min(60, 2 ** (n - 5))`), `login:fail:{sha256(email)}` (window 15 min; at 10 → `login:lock:{sha256(email)}` TTL 15 min, email `security.account_locked { minutes: 15 }` once, audit `auth.account_locked`). `AuthService.login` calls `check` first → `429` with the code, `details: { retryAfterS }` and `Retry-After` header. `RateLimitModule`: `@nestjs/throttler` with Redis storage, two named throttlers — `user` (600/60 s, tracker = user id, applies when authenticated) and `anon` (60/60 s, tracker = client ip, applies when not) — excluded on `/health/*` and `/metrics`; exceeding → `429 RATE_LIMITED`.

- [ ] **Step 1: Write the failing tests**

```ts
// login-throttle.service.spec.ts (ioredis on process.env.REDIS_URL — the package's test index set by applyTestEnv('api'), never DB 0 — keys prefixed per test and flushed in afterEach)
it('allows 5 failures per minute then backs off exponentially', async () => {
  for (let i = 0; i < 5; i++) await t.recordFailure('a@x.io', '1.1.1.1');
  expect(await t.check('a@x.io', '1.1.1.1')).toEqual({ allowed: false, code: 'RATE_LIMITED', retryAfterS: 1 });
  await t.recordFailure('a@x.io', '1.1.1.1'); await t.recordFailure('a@x.io', '1.1.1.1');
  expect((await t.check('a@x.io', '1.1.1.1')).retryAfterS).toBe(4);
  expect(await t.check('a@x.io', '2.2.2.2')).toEqual({ allowed: true }); // other ip, same email, below 10 total
});
it('locks the account for 15 minutes after 10 failures and reports ACCOUNT_LOCKED', ...);
// throttle.e2e-spec.ts
it('AC-AUTH-03: 6th attempt is 429 with Retry-After; after 10 an alert email is sent and the account is locked', async () => {
  const u = await createUser(); const bad = { email: u.email, password: 'wrong wrong wrong' };
  for (let i = 0; i < 5; i++) await http.post('/api/v1/auth/login').set('X-Forwarded-For', '9.9.9.9').send(bad).expect(401);
  const r6 = await http.post('/api/v1/auth/login').set('X-Forwarded-For', '9.9.9.9').send(bad).expect(429);
  expect(r6.body.code).toBe('RATE_LIMITED'); expect(r6.headers['retry-after']).toBe('1');
  for (let ip = 0; ip < 5; ip++) await http.post('/api/v1/auth/login').set('X-Forwarded-For', `10.0.0.${ip}`).send(bad); // reach 10 distinct-ip failures
  const locked = await http.post('/api/v1/auth/login').set('X-Forwarded-For', '10.0.0.9').send({ email: u.email, password: u.password }).expect(429);
  expect(locked.body.code).toBe('ACCOUNT_LOCKED'); expect(email.findByTemplate('security.account_locked', u.email)).toBeTruthy();
});
it('anonymous ip is limited to 60 requests per minute (61st → 429 RATE_LIMITED)', ...); // GET /api/v1/auth/ping public probe route or /api/v1/nope 404s count too
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement** — use Redis `MULTI` with `INCR` + `EXPIRE NX`; `app.set('trust proxy', env.TRUST_PROXY_HOPS)` (default 1) is already in `configureApp`, so the rightmost `X-Forwarded-For` entry is `req.ip` in tests. Both throttlers throw `new ApiError(429, 'RATE_LIMITED' | 'ACCOUNT_LOCKED', …, { retryAfterS })` and set `Retry-After`.
- [ ] **Step 4: Run to verify pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(auth): login throttling with exponential backoff, 15-minute lockout and global rate limits"`

---

### Task 9: Password reset, password change, email change with double confirmation (AC-AUTH-06)

**Files:**
- Create: `apps/api/src/auth/password-reset.service.ts`, `apps/api/src/auth/email-change.service.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`, `apps/api/src/me/me.controller.ts` (created in Task 11 — if Task 9 runs first, put `PATCH /me/password` and `POST /me/email-change` in `auth.controller.ts` under the `/me` path and move them in Task 11), `packages/contracts/src/auth.ts`
- Test: `apps/api/test/auth/password.e2e-spec.ts`, `apps/api/test/auth/email-change.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `POST /auth/password/forgot { email }` (public) → always `202 {}`; when the account exists: invalidate previous `PASSWORD_RESET` tokens, create one (1 h), email `auth.password_reset` with `${WEB_ORIGIN}/${locale}/reset-password?token=`; audit `auth.password_reset_requested` (no audit when unknown email); throttled 3/hour/email.
  - `POST /auth/password/reset { token, newPassword }` (public) → policy check; sets hash; marks token used; `SessionService.revokeAll(userId)`; email `security.password_changed`; audit `auth.password_reset`; used/expired/unknown → `410 TOKEN_INVALID`.
  - `PATCH /me/password { currentPassword, newPassword }` → `401 INVALID_CREDENTIALS` on wrong current; policy; `revokeAll(userId, except: currentSession)`; email; audit `auth.password_changed`.
  - `POST /me/email-change { newEmail, password }` → `409 EMAIL_TAKEN` if used; creates two tokens `EMAIL_CHANGE_OLD` (to current address) and `EMAIL_CHANGE_NEW` (to new address), payload `{ newEmail }`, 24 h; emails `auth.email_change_confirm` to both. `POST /auth/email-change/confirm { token }` (public) → marks that side used; when both sides are used → `email = newEmail`, `emailVerifiedAt = now`, `security.email_changed` to the old address, audit `auth.email_changed`; returns `{ pending: 'OLD' | 'NEW' | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('AC-AUTH-06: forgot is 202 for unknown and known emails alike; only known gets an email', async () => {
  await http.post('/api/v1/auth/password/forgot').send({ email: 'nobody@example.com' }).expect(202); expect(email.sent).toHaveLength(0);
  const u = await createUser(); await http.post('/api/v1/auth/password/forgot').send({ email: u.email.toUpperCase() }).expect(202); expect(email.findByTemplate('auth.password_reset', u.email)).toBeTruthy();
});
it('reset sets the password, revokes every session, and the link is single-use and expires after 1 h', async () => {
  const u = await createUser(); const s = await loginAs(ctx, u);
  await http.post('/api/v1/auth/password/forgot').send({ email: u.email });
  const token = new URL(extractFirstLink(email.last()!.html, '/reset-password')!).searchParams.get('token')!;
  await http.post('/api/v1/auth/password/reset').send({ token, newPassword: 'nouveau mot de passe long' }).expect(200);
  await as(http, s.cookie).get('/api/v1/me').expect(401);
  await http.post('/api/v1/auth/login').send({ email: u.email, password: 'nouveau mot de passe long' }).expect(200);
  await http.post('/api/v1/auth/password/reset').send({ token, newPassword: 'encore un autre mot de passe' }).expect(410);
  // expired: db.verificationToken.update({ expiresAt: past }) on a fresh token → 410 TOKEN_INVALID
});
it('PATCH /me/password keeps the current session and kills the others', ...);
it('email change requires both confirmations; email updates only after the second', async () => {
  const u = await createUser({ email: 'old@example.com' }); const s = await loginAs(ctx, u);
  await as(http, s.cookie).post('/api/v1/me/email-change').send({ newEmail: 'new@example.com', password: u.password }).expect(202);
  const tOld = tokenFrom(email.findByTemplate('auth.email_change_confirm', 'old@example.com')); const tNew = tokenFrom(email.findByTemplate('auth.email_change_confirm', 'new@example.com'));
  expect((await http.post('/api/v1/auth/email-change/confirm').send({ token: tOld }).expect(200)).body.pending).toBe('NEW');
  expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).email).toBe('old@example.com');
  expect((await http.post('/api/v1/auth/email-change/confirm').send({ token: tNew }).expect(200)).body.pending).toBeNull();
  expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).email).toBe('new@example.com');
});
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement the two services and routes.**
- [ ] **Step 4: Run to verify pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(auth): password reset and change, email change with double confirmation"`

---

### Task 10: 2FA — TOTP setup/verify/disable, recovery codes, login challenge, mandatory enforcement (AC-AUTH-05)

**Files:**
- Create: `apps/api/src/auth/two-factor.service.ts`, `apps/api/src/auth/two-factor.policy.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/guards/account-gates.guard.ts`, `packages/contracts/src/auth.ts`
- Test: `apps/api/test/auth/two-factor.e2e-spec.ts`, `apps/api/src/auth/two-factor.policy.spec.ts`

**Interfaces:**
- Produces:
  - `requiresTwoFactor(user: { id; platformRole }): Promise<boolean>` — true if `SUPER_ADMIN` or `crossTenantDb().membership.findFirst({ where: { userId, status: 'ACTIVE', role: { in: ['OWNER','ADMIN'] }, workspace: { type: 'ORGANIZATION' } } })` exists. `AccountGatesGuard` step 4: required and `totpEnabledAt == null` → `403 TWO_FACTOR_SETUP_REQUIRED` (routes tagged `@AllowUnverified()` are exempt: `/auth/2fa/*`, `/auth/logout`, `GET /me`).
  - `TwoFactorService`: `beginSetup(user): Promise<{ secret: string; otpauthUrl: string }>` (otplib secret, issuer `Plateforme cours`, label = email; stores `totpSecretEnc = secretBox.seal(secret)`, keeps `totpEnabledAt` null; `409 TWO_FACTOR_ALREADY_ENABLED` if enabled); `confirmSetup(user, otpCode): Promise<{ recoveryCodes: string[] }>` (window ±1; sets `totpEnabledAt`, 10 codes `xxxxx-xxxxx` from base32 alphabet stored as argon2 hashes; email `security.2fa_enabled`; audit `auth.2fa_enabled`); `verifyLogin(challengeToken, otpCode)` / `verifyRecovery(challengeToken, recoveryCode)` → both validate the challenge (`typ: '2fa'`, `jti` unused → mark used in Redis `2fa:used:{jti}` TTL 5 min), bad code → `401 TWO_FACTOR_INVALID` (counts as a login failure in `LoginThrottleService`), success → `SessionService.createSession`; recovery consumes the matched hash, emails `security.recovery_code_used { remaining }`; `disable(user, otpCode)` → `403 TWO_FACTOR_MANDATORY` when `requiresTwoFactor`, else clears secret + codes, email `security.2fa_disabled`, audit.
  - `AuthService.login` now returns `{ status: 'TWO_FACTOR_REQUIRED', challengeToken }` (no cookies) when `totpEnabledAt` is set.
  - Endpoints (all `@AllowUnverified()`; `verify`/`recovery` additionally `@Public()` when a `challengeToken` is in the body): `POST /auth/2fa/setup` → `{ secret, otpauthUrl }`; `POST /auth/2fa/verify { otpCode }` (authenticated, pending) → `{ recoveryCodes }`; `POST /auth/2fa/verify { challengeToken, otpCode, remember? }` → `200 { status: 'OK', user }` + cookies; `POST /auth/2fa/recovery { challengeToken, recoveryCode, remember? }` → same; `POST /auth/2fa/disable { otpCode }` → `204`. (Field names per the Global Constraints redaction rule — `code` is never a request field.)
  - `MeUser` gains `twoFactor: { enabled: boolean; required: boolean }` (Task 11 serialises it).

- [ ] **Step 1: Write the failing tests**

```ts
// two-factor.e2e-spec.ts (uses otplib's authenticator.generate(secret) in the test)
it('setup → verify enables TOTP, returns 10 recovery codes once, then login requires a challenge', async () => {
  const u = await createUser(); const s = await loginAs(ctx, u);
  const { secret } = (await as(http, s.cookie).post('/api/v1/auth/2fa/setup').expect(200)).body;
  const { recoveryCodes } = (await as(http, s.cookie).post('/api/v1/auth/2fa/verify').send({ otpCode: authenticator.generate(secret) }).expect(200)).body;
  expect(recoveryCodes).toHaveLength(10); expect(recoveryCodes[0]).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
  const login = await http.post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(200);
  expect(login.body.status).toBe('TWO_FACTOR_REQUIRED'); expect(login.headers['set-cookie']).toBeUndefined();
  const ok = await http.post('/api/v1/auth/2fa/verify').send({ challengeToken: login.body.challengeToken, otpCode: authenticator.generate(secret) }).expect(200);
  expect(ok.headers['set-cookie'].join()).toMatch(/nibras_access=/);
});
it('challenge token cannot be used as access token, cannot be replayed, and recovery codes are single-use', async () => {
  /* GET /me with Cookie nibras_access=<challengeToken> → 401; verify twice with the same challenge → second is 401 TOKEN_INVALID; recovery with codes[0] twice (new challenge each time) → second is 401 TWO_FACTOR_INVALID; wrong code → 401 TWO_FACTOR_INVALID */
});
it('AC-AUTH-05: an ADMIN of an organisation without 2FA is blocked everywhere except setup until TOTP is confirmed', async () => {
  const owner = await createUser({ totpSecret: SECRET }); const admin = await createUser();
  const { workspace } = await createOrganization({ owner, admins: [admin] }); const s = await loginAs(ctx, admin);
  await as(http, s.cookie).get(`/api/v1/workspaces/${workspace.id}`).expect(403).expect(({ body }) => expect(body.code).toBe('TWO_FACTOR_SETUP_REQUIRED'));
  await as(http, s.cookie).get('/api/v1/me').expect(200).expect(({ body }) => expect(body.twoFactor).toEqual({ enabled: false, required: true }));
  const { secret } = (await as(http, s.cookie).post('/api/v1/auth/2fa/setup').expect(200)).body;
  await as(http, s.cookie).post('/api/v1/auth/2fa/verify').send({ otpCode: authenticator.generate(secret) }).expect(200);
  await as(http, s.cookie).get(`/api/v1/workspaces/${workspace.id}`).expect(200);
  await as(http, s.cookie).post('/api/v1/auth/2fa/disable').send({ otpCode: authenticator.generate(secret) }).expect(403).expect(({ body }) => expect(body.code).toBe('TWO_FACTOR_MANDATORY'));
});
it('a personal-workspace teacher may enable and later disable 2FA', ...);
// two-factor.policy.spec.ts: SUPER_ADMIN → true; PERSONAL OWNER → false; ORGANIZATION TEACHER → false; ORGANIZATION ADMIN → true; REMOVED admin membership → false
```

(`GET /workspaces/{wid}` exists from Task 14; until then assert the gate on `GET /auth/sessions` which is not exempt.)

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(auth): totp two-factor with recovery codes, login challenge and mandatory policy for admins"`

---

### Task 11: `/me` — profile, locale & timezone, consents with version gate, workspaces list (AC-GDPR-06)

**Files:**
- Create: `apps/api/src/me/{me.module,me.controller,me.service,consent.service}.ts`, `packages/contracts/src/me.ts`
- Modify: `apps/api/src/auth/guards/account-gates.guard.ts` (step 3), `apps/api/src/auth/auth.controller.ts` (move the `/me/*` routes from Task 9)
- Test: `apps/api/test/me/profile.e2e-spec.ts`, `apps/api/test/me/consents.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `MeUserSchema` / `type MeUser = { id, email, firstName, lastName, locale, timezone, birthDate: string | null, phoneE164: string | null, phoneVerifiedAt, emailVerifiedAt, platformRole, status, twoFactor: { enabled, required }, pendingConsents: ConsentType[] }`.
  - `GET /me` (`@AllowUnverified()`) → `MeUser`. `PATCH /me { firstName?, lastName?, locale?, timezone?, birthDate? }` (`UpdateMeSchema` using `LocaleSchema`, `TimezoneSchema`, `BirthDateSchema`) → `MeUser`; audit `user.profile_updated` with before/after of changed keys.
  - `ConsentService.pending(userId): Promise<ConsentType[]>` — each `REQUIRED_CONSENTS` type whose latest granted, unrevoked consent has `version !== CONSENT_VERSIONS[type]`; `grant(user, type, version, meta)` → `422 CONSENT_VERSION_MISMATCH` unless `version === CONSENT_VERSIONS[type]`; idempotent for the same version; audit `consent.granted`; `revoke(user, type)` → only `MARKETING` in this plan (`422 CONSENT_NOT_REVOCABLE` otherwise); audit `consent.revoked`.
  - `GET /me/consents` → `{ type, version, grantedAt, revokedAt, current: boolean }[]`; `POST /me/consents/{type} { version }` (`@AllowUnverified()`) → `201`; `POST /me/consents/{type}/revoke` → `204`.
  - `AccountGatesGuard` step 3: `pending.length > 0` → `403 CONSENT_REQUIRED` `details: { pending }`.
  - `GET /me/workspaces` → `{ workspace: { id, name, slug, type, status }, role, canTeach, status }[]` for every membership whose status is not `REMOVED`/`REJECTED` (cross-tenant, filtered by `userId`), ordered by workspace name.

- [ ] **Step 1: Write the failing tests**

```ts
// profile.e2e-spec.ts
it('GET /me returns the profile with pendingConsents [] and twoFactor', ...);
it('PATCH /me updates locale/timezone/birthDate and audits; invalid values are 422', async () => {
  const u = await createUser(); const s = await loginAs(ctx, u);
  await as(http, s.cookie).patch('/api/v1/me').send({ locale: 'ar', timezone: 'Europe/Paris', birthDate: '2009-05-01' }).expect(200).expect(({ body }) => expect(body).toMatchObject({ locale: 'ar', timezone: 'Europe/Paris', birthDate: '2009-05-01' }));
  for (const bad of [{ timezone: 'Europe/Tunis' }, { locale: 'de' }, { birthDate: '2999-01-01' }, { birthDate: '1850-01-01' }, { timezone: 'UTC+1' }])
    await as(http, s.cookie).patch('/api/v1/me').send(bad).expect(422).expect(({ body }) => expect(body.code).toBe('VALIDATION_FAILED'));
  expect(await db.auditLog.findFirst({ where: { action: 'user.profile_updated' } })).toMatchObject({ before: { locale: 'fr', timezone: 'Africa/Tunis', birthDate: null } });
});
it('GET /me/workspaces lists only my memberships, never another user\'s', ...); // Review Focus 1
// consents.e2e-spec.ts
it('AC-GDPR-06: after a TERMS version bump every non-auth route is 403 CONSENT_REQUIRED until the new version is granted', async () => {
  const u = await createUser(); await grantConsents(u); const s = await loginAs(ctx, u);
  await as(http, s.cookie).get('/api/v1/auth/sessions').expect(200);
  vi.spyOn(consentVersions, 'CONSENT_VERSIONS', 'get').mockReturnValue({ ...CONSENT_VERSIONS, TERMS: 'terms-2027-01' });
  await as(http, s.cookie).get('/api/v1/auth/sessions').expect(403).expect(({ body }) => expect(body.details.pending).toEqual(['TERMS']));
  await as(http, s.cookie).post('/api/v1/me/consents/TERMS').send({ version: 'terms-2026-10' }).expect(422).expect(({ body }) => expect(body.code).toBe('CONSENT_VERSION_MISMATCH'));
  await as(http, s.cookie).post('/api/v1/me/consents/TERMS').send({ version: 'terms-2027-01' }).expect(201);
  await as(http, s.cookie).get('/api/v1/auth/sessions').expect(200);
  expect(await db.consent.count({ where: { userId: u.id, type: 'TERMS' } })).toBe(2);
});
it('revoking TERMS is 422 CONSENT_NOT_REVOCABLE; MARKETING can be granted then revoked', ...);
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement** — `CONSENT_VERSIONS` must be read through a getter/module import at call time (not captured at startup) so the version-bump test can stub it.
- [ ] **Step 4: Run to verify pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(me): profile with locale/timezone, versioned consents gate and workspaces list"`

---

### Task 12: Teacher verification — phone OTP, code of conduct, `TeacherVerifiedGuard` (AC-SAFE-01 at guard level)

**Files:**
- Create: `apps/api/src/me/{phone.service,verification.service}.ts`, `apps/api/src/tenancy/teacher-verified.guard.ts`, `apps/api/src/tenancy/decorators.ts` (`@RequireVerifiedTeacher()`)
- Modify: `apps/api/src/me/me.controller.ts`, `packages/contracts/src/me.ts`
- Test: `apps/api/test/me/phone.e2e-spec.ts`, `apps/api/test/me/verification.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `POST /me/phone/request-otp { phoneE164 }` → validates with `libphonenumber-js` (`isValidPhoneNumber`, E.164 output), creates `PhoneOtp` (6 digits, `codeHash = argon2`, 10 min, replaces any pending), sends via `SMS_PROVIDER` `phone.otp` with `{ otpCode }`; when `NODE_ENV !== 'production'` also emails `phone.otp_dev { otpCode }` to the user (so Mailpit-driven e2e can read it — planner ruling, see spec gaps); 1 request/min/user → `429 RATE_LIMITED`; `202 {}`.
  - `POST /me/phone/verify-otp { otpCode }` → `attempts++`, > 5 → `410 OTP_EXPIRED`; expired → `410 OTP_EXPIRED`; mismatch → `422 OTP_INVALID`; success → `phoneE164`, `phoneVerifiedAt = now`, delete the OTP, audit `phone.verified`, `200 MeUser`. Changing the phone later = same flow (new OTP; `phoneVerifiedAt` reset only on success).
  - `VerificationService.status(user): Promise<{ emailVerified: boolean; phoneVerified: boolean; codeOfConductAccepted: boolean; missing: ('EMAIL' | 'PHONE' | 'CODE_OF_CONDUCT')[] }>` (CoC accepted = unrevoked consent at the current `CONSENT_VERSIONS.CODE_OF_CONDUCT`); `GET /me/verification` returns it.
  - `TeacherVerifiedGuard` + `@RequireVerifiedTeacher()`: when `missing.length > 0` → `403 TEACHER_NOT_VERIFIED` with `details: { missing }`. SP2 (`POST …/invitations`, `…/invite-links`), SP3 (`POST …/courses/{cid}/publish`) and SP6 (`POST …/room/open`) **must** decorate those routes with it; this plan applies it to nothing in production code and tests it on a test-only controller route `POST /api/v1/__test/teacher-only`.

- [ ] **Step 1: Write the failing tests**

```ts
// phone.e2e-spec.ts
it('request → verify sets phoneVerifiedAt; wrong code, expiry and 6th attempt are rejected', async () => {
  const u = await createUser(); const s = await loginAs(ctx, u);
  await as(http, s.cookie).post('/api/v1/me/phone/request-otp').send({ phoneE164: '+21655123456' }).expect(202);
  const otpCode = sms.last('+21655123456')!.params.otpCode; expect(otpCode).toMatch(/^\d{6}$/); expect(email.findByTemplate('phone.otp_dev', u.email)?.params.otpCode).toBe(otpCode);
  await as(http, s.cookie).post('/api/v1/me/phone/verify-otp').send({ otpCode: '000000' }).expect(422).expect(({ body }) => expect(body.code).toBe('OTP_INVALID'));
  await as(http, s.cookie).post('/api/v1/me/phone/verify-otp').send({ otpCode }).expect(200).expect(({ body }) => expect(body.phoneE164).toBe('+21655123456'));
  expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).phoneVerifiedAt).toBeInstanceOf(Date);
});
it('rejects a non-E.164 or invalid number with 422 and a second request within a minute with 429', ...);
// verification.e2e-spec.ts
it('AC-SAFE-01 (guard): missing steps are listed; after OTP + code of conduct the route opens', async () => {
  const u = await createUser({ emailVerified: true }); const s = await loginAs(ctx, u);
  expect((await as(http, s.cookie).get('/api/v1/me/verification').expect(200)).body.missing).toEqual(['PHONE', 'CODE_OF_CONDUCT']);
  await as(http, s.cookie).post('/api/v1/__test/teacher-only').expect(403).expect(({ body }) => { expect(body.code).toBe('TEACHER_NOT_VERIFIED'); expect(body.details.missing).toEqual(['PHONE', 'CODE_OF_CONDUCT']); });
  /* verify phone as above; POST /me/consents/CODE_OF_CONDUCT { version: 'coc-2026-10' } */
  await as(http, s.cookie).post('/api/v1/__test/teacher-only').expect(200);
});
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(me): phone otp verification, code of conduct and teacher-verified guard"`

---

### Task 13: Workspace context guard, suspended gate, permission matrix and guard (AC-WS-01, AC-WS-03, AC-WS-06)

**Files:**
- Create: `packages/contracts/src/permissions.ts`, `apps/api/src/tenancy/{tenancy.module,workspace-context.guard,permission.guard,permissions}.ts`
- Modify: `apps/api/src/tenancy/decorators.ts` (`@RequirePermission(p)`, `@CrossTenant()` marker for documentation), `apps/api/src/app.module.ts` (guards after `AccountGatesGuard`)
- Test: `packages/contracts/src/permissions.test.ts`, `apps/api/test/tenancy/workspace-context.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `@nibras/contracts`: `type Permission` — the §7 capability list as dotted keys: `workspace.settings.update`, `workspace.staff.manage`, `workspace.delete`, `workspace.transfer`, `workspace.audit.read`, `workspace.members.read`, `student.invite`, `student.assign`, `student.read`, `student.update`, `student.remove`, `abuse.report`, `abuse.handle`, `course.create`, `course.manage`, `course.delete`, `course.media.manage`, `enrollment.manage`, `course.reassign`, `course.read`, `pdf.download`, `progress.read`, `session.manage`, `room.open`, `room.join`, `room.moderate`, `calendar.read`, `session.history.read`, `attendance.read`, `attendance.override`, `report.write`, `report.read`, `report.private_notes.read`, `message.direct`, `dashboard.teacher`, `account.export`, `account.delete`. `type Grant = 'all' | 'own' | 'none'` (✅/👁 → `all`, 🔒 → `own`, ❌ → `none`; P1 cells → `none`). `MATRIX: Record<Permission, Record<'ADMIN' | 'TEACHER' | 'ASSISTANT' | 'STUDENT' | 'GUARDIAN', Grant>>` transcribed from §7 (the `OWNER/ADMIN (org)` column is `ADMIN`); `OWNER_ONLY: Permission[] = ['workspace.delete', 'workspace.transfer']`; `PERSONAL_OWNER_OVERRIDES` for the cells where §7 says "(espace personnel)": `workspace.settings.update: 'all'`, `workspace.audit.read: 'all'`, `student.remove: 'all'`, and `abuse.handle: 'none'` (a personal owner never instructs reports about himself). `grantFor(ctx: { role: MembershipRole; canTeach: boolean; workspaceType: WorkspaceType }, p: Permission): Grant` — rules: PERSONAL OWNER = max(TEACHER column, overrides); ORGANIZATION OWNER = ADMIN column plus `OWNER_ONLY`; ADMIN with `canTeach` = max(ADMIN, TEACHER) per cell; `course.create` and `dashboard.teacher` are `none` for ADMIN without `canTeach` (AC-WS-03); `max` orders `all > own > none`.
  - `WorkspaceContextGuard` (global, only when the route has a `:wid` param): loads the workspace (`db.workspace`), then the membership with `tenantDb(wid)`; workspace missing, membership missing, or status `REMOVED`/`REJECTED`, or caller is `SUPER_ADMIN` without membership → `404 NOT_FOUND` (`new ApiError(404, 'NOT_FOUND', 'Not found')` — the generic code is the intended one here); when the workspace exists and the caller is not an active member → audit `auth.forbidden_workspace` (`workspaceId`, actor) before the 404; membership in another non-ACTIVE status → `ApiError(403, 'MEMBERSHIP_INACTIVE', …, { status })`; workspace `SUSPENDED` or `DELETING` and method not in `GET/HEAD/OPTIONS` → `ApiError(423, 'WORKSPACE_SUSPENDED', …, { reason })` (423 is not in the filter's status map, so only `ApiError` yields this code); otherwise stores `workspace` + `membership` in `RequestContext`.
  - `PermissionGuard` with `@RequirePermission(p)`: `grantFor(...)` → `none` → `403 PERMISSION_DENIED`; `own` → `RequestContext.permissionScope = 'own'`; services call `assertOwn(ownerUserId)` (throws `403 PERMISSION_DENIED`) when scope is `own`.
  - Test-only controller `TenancyProbeController` under `/api/v1/workspaces/:wid/__probe` with `GET /` (`workspace.members.read`), `POST /` (`workspace.settings.update`), `POST /course` (`course.create`) — registered only by `createTestApp`.

- [ ] **Step 1: Write the failing tests**

```ts
// permissions.test.ts
it('AC-WS-03 at policy level: ADMIN without can_teach cannot create a course, with can_teach can', () => {
  expect(grantFor({ role: 'ADMIN', canTeach: false, workspaceType: 'ORGANIZATION' }, 'course.create')).toBe('none');
  expect(grantFor({ role: 'ADMIN', canTeach: true, workspaceType: 'ORGANIZATION' }, 'course.create')).toBe('all');
});
it('personal owner has teacher rights plus settings/audit/remove; org teacher has own-scoped rights', () => {
  expect(grantFor({ role: 'OWNER', canTeach: false, workspaceType: 'PERSONAL' }, 'workspace.settings.update')).toBe('all');
  expect(grantFor({ role: 'TEACHER', canTeach: false, workspaceType: 'ORGANIZATION' }, 'workspace.settings.update')).toBe('none');
  expect(grantFor({ role: 'TEACHER', canTeach: false, workspaceType: 'ORGANIZATION' }, 'session.manage')).toBe('own');
  expect(grantFor({ role: 'STUDENT', canTeach: false, workspaceType: 'ORGANIZATION' }, 'abuse.report')).toBe('all');
  expect(grantFor({ role: 'OWNER', canTeach: false, workspaceType: 'PERSONAL' }, 'abuse.handle')).toBe('none');
  expect(grantFor({ role: 'ADMIN', canTeach: false, workspaceType: 'ORGANIZATION' }, 'workspace.delete')).toBe('none');
  expect(grantFor({ role: 'OWNER', canTeach: false, workspaceType: 'ORGANIZATION' }, 'workspace.delete')).toBe('all');
});
it('every Permission has a row and every row has the five columns', ...);
// workspace-context.e2e-spec.ts
it('AC-WS-01: teacher of org A calling org B gets 404 and an auth.forbidden_workspace audit row', async () => {
  const t = await createUser(); const A = await createOrganization({ owner: await createUser({ totpSecret: S }), teachers: [t] }); const B = await createOrganization({ owner: await createUser({ totpSecret: S }) });
  const s = await loginAs(ctx, t);
  await as(http, s.cookie).get(`/api/v1/workspaces/${B.workspace.id}/__probe`).expect(404).expect(({ body }) => expect(body.code).toBe('NOT_FOUND'));
  expect(await db.auditLog.findFirst({ where: { action: 'auth.forbidden_workspace', actorUserId: t.id, workspaceId: B.workspace.id } })).toBeTruthy();
  await as(http, s.cookie).get(`/api/v1/workspaces/${randomUUID()}/__probe`).expect(404);
});
it('AC-WS-03 over HTTP: admin without can_teach → 403 PERMISSION_DENIED on POST /course; with can_teach → 200', ...);
it('AC-WS-06: suspended workspace → GET 200, POST 423 WORKSPACE_SUSPENDED', ...);
it('super-admin without membership gets 404 on workspace routes', ...);
it('REMOVED member gets 404; PENDING_GUARDIAN_CONSENT member gets 403 MEMBERSHIP_INACTIVE', ...);
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement** — guard registration order in `app.module.ts`: `JwtAuthGuard`, `AccountGatesGuard`, `WorkspaceContextGuard`, `PermissionGuard`, `TeacherVerifiedGuard`.
- [ ] **Step 4: Run to verify pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(tenancy): workspace context guard with 404-on-foreign-tenant, suspended gate and §7 permission matrix"`

---

### Task 14: Workspaces — organisation creation, personal workspace rule (D-O7), settings, storage, delete, transfer ownership, audit log (AC-WS-04, AC-WS-08)

**Files:**
- Create: `packages/contracts/src/{workspace-settings,workspaces}.ts`, `apps/api/src/workspaces/{workspaces.module,workspaces.controller,workspaces.service,workspace-settings.service,audit-log.controller}.ts`
- Modify: `apps/api/src/auth/register.service.ts` (use `WorkspacesService.createPersonal`), `apps/api/src/me/me.controller.ts` (`POST /me/personal-workspace`)
- Test: `apps/api/test/workspaces/workspaces.e2e-spec.ts`, `apps/api/test/workspaces/settings.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `WorkspaceSettingsSchema` (zod, `v: z.literal(1)`) with keys and defaults from PRD §8.2.1: `default_timezone` (IANA; default = owner timezone at creation), `teacher_join_window_min: 15`, `student_join_window_min: 10`, `empty_room_grace_min: 5`, `late_threshold_min: 10`, `present_ratio: 0.75`, `partial_ratio: 0.25`, `default_sequential_lessons: false`, `default_pdf_download: false`, `default_reminder_offsets_min: [1440, 15, 0]`; ranges: windows 0–60, grace 1–30, late 0–60, ratios 0–1 with `partial_ratio < present_ratio`, offsets 0–10080 (≤ 5 values). `defaultWorkspaceSettings(ownerTimezone): WorkspaceSettings`.
  - `WorkspacesService.createPersonal(owner: User, tx?)` (as Task 6, quota 20 GiB) and `createOrganization(owner, input: { name, country?, timezone }): Promise<Workspace>` (type ORGANIZATION, quota 200 GiB, `allowPersonalWorkspaces: true`, OWNER membership; audit `workspace.created`); `createPersonalForInvitedTeacher(user)` (AC-WS-08): `409 PERSONAL_WORKSPACE_EXISTS` if the user already owns a PERSONAL workspace; for every ORGANIZATION where the user has an ACTIVE membership with role `TEACHER`/`ADMIN`, `allowPersonalWorkspaces === false` → `403 PERSONAL_WORKSPACE_FORBIDDEN` `details: { organizationId, organizationName }` (first one found); otherwise creates it.
  - Endpoints: `POST /workspaces { name, country?, timezone }` → `201 Workspace` (any verified user); `POST /me/personal-workspace` → `201`; `GET /workspaces/{wid}` (any active member) → `{ id, name, slug, type, status, country, defaultTimezone, defaultLocale, allowPersonalWorkspaces, createdAt, myRole, myCanTeach }`; `PATCH /workspaces/{wid} { name?, country?, defaultTimezone?, defaultLocale?, allowPersonalWorkspaces? }` (`workspace.settings.update`; `allowPersonalWorkspaces` only on ORGANIZATION → `422` otherwise; audit `workspace.updated`); `GET/PATCH /workspaces/{wid}/settings` (`workspace.settings.update` for PATCH, any member for GET; PATCH is a partial merge validated against the full schema; audit `workspace.settings_updated`); `GET /workspaces/{wid}/storage` → `{ quotaBytes, usedBytes }` (strings, bigint-safe); `DELETE /workspaces/{wid}` (`workspace.delete`) → status `DELETING`, `deletedAt = now`, audit `workspace.deleted`, `204` (purge after 30 days is SP11); `POST /workspaces/{wid}/transfer-ownership { toUserId }` (`workspace.transfer`; `409 NOT_AN_ORGANIZATION` on PERSONAL; target must be an ACTIVE `ADMIN` → else `422 VALIDATION_FAILED`): in one tx old OWNER → ADMIN (keeps `canTeach`), target → OWNER; audit `workspace.ownership_transferred`; email `workspace.ownership_transferred` to both; `204`; `GET /workspaces/{wid}/audit-log?action&actorUserId&from&to&cursor&limit≤100` (`workspace.audit.read`) → `{ items: AuditEntry[], nextCursor }` newest first.

- [ ] **Step 1: Write the failing tests**

```ts
it('creates an organisation with owner membership, 200 GiB quota, defaults and audit', async () => {
  const u = await createUser({ totpSecret: S }); const s = await loginAs(ctx, u);
  const res = await as(http, s.cookie).post('/api/v1/workspaces').send({ name: 'Académie Nour', country: 'MA', timezone: 'Africa/Casablanca' }).expect(201);
  expect(res.body).toMatchObject({ type: 'ORGANIZATION', slug: expect.stringMatching(/^academie-nour-[a-z2-7]{6}$/), allowPersonalWorkspaces: true });
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: res.body.id }, include: { memberships: true } });
  expect(ws.storageQuotaBytes).toBe(200n * 1024n ** 3n); expect(ws.memberships[0]).toMatchObject({ userId: u.id, role: 'OWNER', status: 'ACTIVE' });
  expect(WorkspaceSettingsSchema.parse(ws.settings)).toMatchObject({ default_timezone: 'Africa/Casablanca', present_ratio: 0.75, default_reminder_offsets_min: [1440, 15, 0] });
});
it('AC-WS-08: invited teacher has no PERSONAL workspace; creation allowed unless an organisation forbids it; self-signup teacher always has one', async () => {
  const teacher = await createUser(); const orgA = await createOrganization({ owner: await createUser({ totpSecret: S }), teachers: [teacher] });
  const orgB = await createOrganization({ owner: await createUser({ totpSecret: S }), teachers: [teacher], allowPersonalWorkspaces: false });
  const s = await loginAs(ctx, teacher);
  expect((await as(http, s.cookie).get('/api/v1/me/workspaces').expect(200)).body.map((m) => m.workspace.type)).toEqual(['ORGANIZATION', 'ORGANIZATION']);
  const forbidden = await as(http, s.cookie).post('/api/v1/me/personal-workspace').expect(403);
  expect(forbidden.body.code).toBe('PERSONAL_WORKSPACE_FORBIDDEN'); expect(forbidden.body.details).toEqual({ organizationId: orgB.workspace.id, organizationName: orgB.workspace.name });
  await db.workspace.update({ where: { id: orgB.workspace.id }, data: { allowPersonalWorkspaces: true } });
  await as(http, s.cookie).post('/api/v1/me/personal-workspace').expect(201).expect(({ body }) => expect(body).toMatchObject({ type: 'PERSONAL', name: `Espace de ${teacher.firstName}` }));
  await as(http, s.cookie).post('/api/v1/me/personal-workspace').expect(409).expect(({ body }) => expect(body.code).toBe('PERSONAL_WORKSPACE_EXISTS'));
  // self-signup: POST /auth/register (Task 6) → GET /me/workspaces contains one PERSONAL
});
it('AC-WS-04: owner transfers to an admin; roles swap, audit row and both emails', async () => {
  const owner = await createUser({ totpSecret: S }); const admin = await createUser({ totpSecret: S }); const { workspace } = await createOrganization({ owner, admins: [admin] });
  await as(http, (await loginAs(ctx, owner)).cookie).post(`/api/v1/workspaces/${workspace.id}/transfer-ownership`).send({ toUserId: admin.id }).expect(204);
  const roles = Object.fromEntries((await db.membership.findMany({ where: { workspaceId: workspace.id } })).map((m) => [m.userId, m.role]));
  expect(roles).toEqual({ [owner.id]: 'ADMIN', [admin.id]: 'OWNER' });
  expect(await db.auditLog.findFirst({ where: { action: 'workspace.ownership_transferred', workspaceId: workspace.id } })).toMatchObject({ before: { ownerUserId: owner.id }, after: { ownerUserId: admin.id } });
  expect(email.findByTemplate('workspace.ownership_transferred', owner.email)).toBeTruthy(); expect(email.findByTemplate('workspace.ownership_transferred', admin.email)).toBeTruthy();
});
it('an ADMIN cannot transfer or delete (403), a TEACHER cannot change settings (403), a personal owner can', ...);
it('settings PATCH validates ranges (partial_ratio ≥ present_ratio → 422) and audits before/after', ...);
it('audit-log endpoint is paginated newest-first and filterable by action; TEACHER in org gets 403', ...);
it('DELETE marks DELETING; subsequent mutations are 423', ...);
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(workspaces): organisation and personal workspace creation, settings, storage, delete, ownership transfer and audit log"`

---

### Task 15: Members and teacher↔student assignments (AC-WS-02, AC-WS-05, Review Focus 1)

**Files:**
- Create: `packages/contracts/src/members.ts`, `apps/api/src/members/{members.module,members.controller,members.service,membership.service,assignments.controller,assignments.service,removal-blockers}.ts`
- Test: `apps/api/test/members/members.e2e-spec.ts`, `apps/api/test/members/assignments.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `MembershipService.addMember(input: { workspaceId; userId; role: MembershipRole; status: MembershipStatus; canTeach?: boolean; invitedByUserId?: string }, tx?: TenantClient): Promise<Membership>` — `409 ALREADY_MEMBER` if a non-`REMOVED` membership exists; a `REMOVED` one is reactivated (same row, PRD §10.4); in a PERSONAL workspace a `STUDENT` also gets `TeacherStudentAssignment(owner → student)` automatically (§11.2); audit `member.added`. SP2's invitation flow consumes this.
  - `MEMBER_REMOVAL_BLOCKERS` multi-provider token: `interface MemberRemovalBlocker { check(workspaceId: string, userId: string): Promise<{ code: 'MEMBER_HAS_FUTURE_SESSIONS'; items: unknown[] } | null> }` (SP5 registers the sessions check; SP1 registers none and tests with a stub).
  - `MembersService`: `list(ctx, q: { role?, status?, q?, cursor?, limit })` — scope `all` → everyone; scope `own` (TEACHER in an organisation) → only `STUDENT` members assigned to the caller or `invitedByUserId === caller`; `get(ctx, uid)` same scoping → `404` outside scope; `update(ctx, uid, { role?, canTeach? })` — only between `ADMIN` ↔ `TEACHER` (`422 ROLE_CHANGE_NOT_ALLOWED` for STUDENT/GUARDIAN/OWNER), audit `member.role_changed` before/after `{ role, canTeach }`; `remove(ctx, uid, reason?)` — OWNER target → `409 OWNER_CANNOT_BE_REMOVED`; STUDENT target requires `student.remove`, staff requires `workspace.staff.manage`; runs blockers → `409 <code>` with `details.items`; sets `status: REMOVED`, `removedAt`, `removalReason`; revokes nothing at user level; emits `MembershipRemovedEvent { workspaceId, userId, role }`; audit `member.removed`.
  - Endpoints: `GET /workspaces/{wid}/members?role&status&q&cursor&limit` (`workspace.members.read`) → `{ items: MemberSummary[], nextCursor }` where `MemberSummary = { userId, firstName, lastName, email, role, canTeach, status, joinedAt }` (email omitted when scope is `own`); `GET …/members/{uid}`; `PATCH …/members/{uid}` (`workspace.staff.manage`); `DELETE …/members/{uid}` → `204`; `GET /workspaces/{wid}/assignments?teacherUserId&studentUserId` (`student.assign` for POST/DELETE; GET allowed with scope `own` filtered to the caller); `POST …/assignments { teacherUserId, studentUserId }` → `201` / `409 ALREADY_ASSIGNED` / `422` when roles don't match (teacher must be `TEACHER` or `ADMIN+canTeach`, student must be `STUDENT`, both ACTIVE); `DELETE …/assignments/{id}` → `204`; audits `assignment.created` / `assignment.deleted`.

- [ ] **Step 1: Write the failing tests**

```ts
it('AC-WS-02: teacher with 2 of 50 assigned students lists 2; admin lists 50', async () => {
  const owner = await createUser({ totpSecret: S }); const t = await createUser(); const students = await Promise.all(Array.from({ length: 50 }, () => createUser()));
  const { workspace } = await createOrganization({ owner, teachers: [t], students });
  for (const st of students.slice(0, 2)) await as(http, (await loginAs(ctx, owner)).cookie).post(`/api/v1/workspaces/${workspace.id}/assignments`).send({ teacherUserId: t.id, studentUserId: st.id }).expect(201);
  const mine = await as(http, (await loginAs(ctx, t)).cookie).get(`/api/v1/workspaces/${workspace.id}/members?role=STUDENT&limit=100`).expect(200);
  expect(mine.body.items).toHaveLength(2); expect(mine.body.items[0].email).toBeUndefined();
  expect((await as(http, (await loginAs(ctx, owner)).cookie).get(`/api/v1/workspaces/${workspace.id}/members?role=STUDENT&limit=100`).expect(200)).body.items).toHaveLength(50);
});
it('Review Focus 1: GET members/{uid} for a user who is only a member of another workspace is 404', ...);
it('AC-WS-05: removal blocked by a registered blocker with the list of sessions', async () => {
  // override MEMBER_REMOVAL_BLOCKERS with a stub returning { code: 'MEMBER_HAS_FUTURE_SESSIONS', items: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] }
  const res = await adminAgent.delete(`/api/v1/workspaces/${wid}/members/${teacher.id}`).expect(409);
  expect(res.body.code).toBe('MEMBER_HAS_FUTURE_SESSIONS'); expect(res.body.details.items).toHaveLength(3);
  expect((await db.membership.findFirst({ where: { workspaceId: wid, userId: teacher.id } }))!.status).toBe('ACTIVE');
});
it('student removal: org TEACHER → 403, org ADMIN → 204 with REMOVED + audit + event; personal OWNER → 204', ...);
it('owner cannot be removed (409); role change STUDENT→ADMIN is 422; TEACHER→ADMIN audited and then 2FA is required for that user', ...);
it('addMember on a REMOVED membership reactivates the same row; personal workspace auto-creates the assignment', ...);
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement** (`@nestjs/event-emitter` `EventEmitter2` for `MembershipRemovedEvent`).
- [ ] **Step 4: Run to verify pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(members): scoped member listing, role changes, removal with blockers and teacher-student assignments"`

---

### Task 16: Abuse reports — creation with frozen snapshot, org/super-admin queues, MINOR_SAFETY escalation and 24 h reminder (AC-SAFE-05; hooks for AC-SAFE-02/03)

**Files:**
- Create: `packages/contracts/src/abuse.ts`, `apps/api/src/abuse-reports/{abuse-reports.module,abuse-reports.controller,abuse-reports.service,snapshot.registry}.ts`, `apps/worker/src/processors/abuse.processor.ts`
- Test: `apps/api/test/abuse/abuse-reports.e2e-spec.ts`, `apps/worker/test/abuse.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `SnapshotRegistry.register(entityType: AbuseEntityType, fn: (entityId: string, workspaceId: string | null) => Promise<Record<string, unknown> | null>)` and `snapshot(entityType, entityId, workspaceId)` → `422 ENTITY_TYPE_UNSUPPORTED` when no provider is registered, `404 NOT_FOUND` when the provider returns `null`. SP1 registers `USER` → `{ userId, firstName, lastName, membership: { role, status } | null, capturedAt }`. SP6 registers `SESSION` (session, participants, last 50 room-chat messages — AC-SAFE-02), SP8 `MESSAGE`, SP3 `COURSE`.
  - `AbuseReportsService.create(reporter, input: { workspaceId: string | null; category: AbuseCategory; description: string (10–4000); entityType; entityId; attachments?: string[] })` → `AbuseReport OPEN` with `contextSnapshot`; ack email `abuse.report_received` to the reporter; notify by email `abuse.new_report`: ORGANIZATION → active OWNER/ADMIN members (+ every `SUPER_ADMIN` user when `MINOR_SAFETY`); PERSONAL or no workspace → `SUPER_ADMIN` users only; `MINOR_SAFETY` → `QueueService.add('compliance', 'abuse.minor_safety_reminder', { reportId }, { delay: 24 h, jobId: 'abuse:{id}:minor-safety-reminder' })`; audit `abuse_report.created` (never includes the reporter in `after` beyond its id); `update(actor, id, { status?, resolution?, assignedToUserId? })` → sets `resolvedAt` on `RESOLVED`/`DISMISSED`; audit `abuse_report.updated`; `isEntityUnderReview(entityType, entityId): Promise<boolean>` (`OPEN` or `IN_REVIEW`) for SP8's `409 MESSAGE_UNDER_REVIEW`.
  - Endpoints: `POST /workspaces/{wid}/abuse-reports` (`abuse.report`) → `201 { id, status }`; `POST /abuse-reports` (any authenticated user; `entityType` must be `USER`, `workspaceId` null) → `201`; `GET /me/abuse-reports` → own reports `{ id, category, status, entityType, createdAt, resolvedAt }` (no snapshot); `GET /workspaces/{wid}/abuse-reports?status&category&cursor&limit` and `PATCH /workspaces/{wid}/abuse-reports/{id}` (`abuse.handle`; items include `reporter: { userId, firstName, lastName }`, `contextSnapshot`); `GET /admin/abuse-reports?status&category&workspaceId&cursor&limit` and `PATCH /admin/abuse-reports/{id}` (super-admin, Task 17 guard; `MINOR_SAFETY` reports always listed regardless of workspace handling).
  - Worker processor `abuse.minor_safety_reminder`: if the report is still `OPEN` → email `abuse.minor_safety_reminder` to every `SUPER_ADMIN`; otherwise no-op; idempotent by `jobId`.

- [ ] **Step 1: Write the failing tests**

```ts
it('a student reports a teacher in an organisation: OPEN report with USER snapshot, ack email, admins + (for MINOR_SAFETY) super-admins notified, reminder job queued', async () => {
  const sa = await createUser({ platformRole: 'SUPER_ADMIN', totpSecret: S }); const owner = await createUser({ totpSecret: S }); const teacher = await createUser(); const student = await createUser();
  const { workspace } = await createOrganization({ owner, teachers: [teacher], students: [student] });
  const res = await as(http, (await loginAs(ctx, student)).cookie).post(`/api/v1/workspaces/${workspace.id}/abuse-reports`).send({ category: 'MINOR_SAFETY', description: 'Comportement inapproprié pendant la session.', entityType: 'USER', entityId: teacher.id }).expect(201);
  const report = await db.abuseReport.findUniqueOrThrow({ where: { id: res.body.id } });
  expect(report).toMatchObject({ status: 'OPEN', reporterUserId: student.id, workspaceId: workspace.id });
  expect(report.contextSnapshot).toMatchObject({ userId: teacher.id, membership: { role: 'TEACHER' } });
  expect(email.findByTemplate('abuse.report_received', student.email)).toBeTruthy();
  expect(email.findByTemplate('abuse.new_report', owner.email)).toBeTruthy(); expect(email.findByTemplate('abuse.new_report', sa.email)).toBeTruthy(); expect(email.findByTemplate('abuse.new_report', teacher.email)).toBeFalsy();
  expect(queue.jobs).toContainEqual(expect.objectContaining({ queue: 'compliance', name: 'abuse.minor_safety_reminder', data: { reportId: report.id }, opts: expect.objectContaining({ delay: 24 * 3600 * 1000, jobId: `abuse:${report.id}:minor-safety-reminder` }) }));
});
it('HARASSMENT in an organisation notifies admins only; in a personal workspace only super-admins; owner of a personal workspace cannot list reports (403)', ...);
it('AC-SAFE-05: MINOR_SAFETY report handled by the org stays visible to the super-admin', async () => { /* org admin PATCH status IN_REVIEW → GET /admin/abuse-reports still contains it */ });
it('Review Focus 1: GET /me/abuse-reports returns only my reports; the reported teacher cannot read the report via any route', ...);
it('entityType MESSAGE without a registered snapshotter is 422 ENTITY_TYPE_UNSUPPORTED; isEntityUnderReview flips with status', ...);
// worker abuse.e2e-spec.ts: seed OPEN report + 2 super-admins → run processor → 2 reminder emails; RESOLVED report → none
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement** — the processor registers in `onModuleInit` through `ProcessorRegistry.registerProcessor(QUEUES.compliance, 'abuse.minor_safety_reminder', handler)` (SP0 pattern, `processors/ping.processor.ts`); the worker test boots `WorkerModule` with the `EMAIL_PROVIDER` token overridden by `InMemoryEmailProvider`, uses `systemPrisma()` on `nibras_worker_test` and `obliterateAllQueues()` from `test/redis.ts` in `beforeEach`.
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run test --filter=@nibras/api --filter=@nibras/worker --concurrency=2` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(abuse): abuse reports with frozen snapshots, admin queues, minor-safety escalation and 24h reminder job"`

---

### Task 17: Super-admin console API — guard, workspaces, suspensions, quotas, user suspension, health, first-admin CLI (AC-SAFE-04 partial, US-X01/X02/X03)

**Files:**
- Create: `packages/contracts/src/admin.ts`, `apps/api/src/tenancy/super-admin.guard.ts` (+ `@SuperAdminOnly()` in `decorators.ts`), `apps/api/src/admin/{admin.module,admin.controller,admin.service,user-suspension.service}.ts`, `apps/api/src/cli/create-super-admin.ts`
- Test: `apps/api/test/admin/admin.e2e-spec.ts`, `apps/api/src/cli/create-super-admin.spec.ts`

**Interfaces:**
- Produces:
  - `SuperAdminGuard`: `platformRole !== 'SUPER_ADMIN'` → `403 PERMISSION_DENIED`; 2FA is already mandatory via the account gate.
  - `GET /admin/workspaces?type&status&q&cursor&limit` → `{ items: { id, type, name, slug, status, suspendedReason, memberCount, storageUsedBytes, storageQuotaBytes, createdAt }[], nextCursor }` (system-role client is **not** used; the query goes through `crossTenantDb()` for member counts via `groupBy` on `workspaceId` — the only place a cross-tenant aggregate without `userId` is permitted, so `crossTenantDb()` accepts an explicit `{ reason: 'super_admin' }` option that skips the user-filter check and audits `admin.cross_tenant_query`).
  - `POST /admin/workspaces/{wid}/suspend { reason }` → `status SUSPENDED`, `suspendedReason`, `suspendedAt`; audit `workspace.suspended`; `POST …/unsuspend` → ACTIVE, audit; `PATCH /admin/workspaces/{wid}/quota { storageQuotaBytes }` (≥ `storageUsedBytes`, ≤ 10 TiB) → audit `workspace.quota_changed`.
  - `UserSuspensionService.suspend(actor, userId, reason)` — target `SUPER_ADMIN` → `409 CANNOT_SUSPEND_SUPER_ADMIN`; sets `status SUSPENDED`, `suspendedReason`, `suspendedAt`; `SessionService.revokeAll(userId)`; every PERSONAL workspace owned by the user → `SUSPENDED` with `suspendedReason = 'OWNER_SUSPENDED'`; emits `UserSuspendedEvent { userId, reason }` (SP5/SP6 cancel `SCHEDULED` sessions and end `LIVE` ones — AC-SAFE-04 remainder); email `admin.user_suspended { reason }`; audit `user.suspended`. `unsuspend(actor, userId)` → ACTIVE; owned workspaces whose `suspendedReason === 'OWNER_SUSPENDED'` → ACTIVE; email; audit `user.unsuspended`. Endpoints `POST /admin/users/{uid}/suspend { reason }`, `POST /admin/users/{uid}/unsuspend` → `204`.
  - `GET /admin/health` → `{ db: 'up' | 'down', redis: 'up' | 'down', queues: { name, waiting, active, delayed, failed }[] }` from `Queue.getJobCounts()` for every `QUEUES` entry.
  - CLI `pnpm --filter @nibras/api cli create-super-admin --email <e> --password <p> [--first-name --last-name]` → creates (or promotes) the user with `platformRole SUPER_ADMIN`, `emailVerifiedAt = now`, consents at current versions; prints a reminder that 2FA setup is forced at first login. `createSuperAdmin(db, input)` is the tested function.

- [ ] **Step 1: Write the failing tests**

```ts
it('non super-admin gets 403 on /admin/*; super-admin lists workspaces with member counts', ...);
it('workspace suspend/unsuspend flips status with reason and audit; member sees 423 on mutations while suspended', ...);
it('AC-SAFE-04 (SP1 part): suspending a teacher revokes sessions immediately, suspends his personal workspace read-only, emails him, audits, and emits UserSuspendedEvent; unsuspend restores both', async () => {
  const sa = await createUser({ platformRole: 'SUPER_ADMIN', totpSecret: S }); const teacher = await createUser(); const personal = await createPersonalWorkspace(teacher);
  const tSession = await loginAs(ctx, teacher); const events: unknown[] = []; app.get(EventEmitter2).on('user.suspended', (e) => events.push(e));
  await as(http, (await loginAs(ctx, sa)).cookie).post(`/api/v1/admin/users/${teacher.id}/suspend`).send({ reason: 'Signalement confirmé' }).expect(204);
  await as(http, tSession.cookie).get('/api/v1/me').expect(401);
  await http.post('/api/v1/auth/login').send({ email: teacher.email, password: teacher.password }).expect(403).expect(({ body }) => expect(body.code).toBe('ACCOUNT_SUSPENDED'));
  expect((await db.workspace.findUniqueOrThrow({ where: { id: personal.id } }))).toMatchObject({ status: 'SUSPENDED', suspendedReason: 'OWNER_SUSPENDED' });
  expect(events).toEqual([{ userId: teacher.id, reason: 'Signalement confirmé' }]); expect(email.findByTemplate('admin.user_suspended', teacher.email)).toBeTruthy();
  expect(await db.auditLog.findFirst({ where: { action: 'user.suspended', entityId: teacher.id, actorUserId: sa.id } })).toBeTruthy();
  await as(http, (await loginAs(ctx, sa)).cookie).post(`/api/v1/admin/users/${teacher.id}/unsuspend`).expect(204);
  expect((await db.workspace.findUniqueOrThrow({ where: { id: personal.id } })).status).toBe('ACTIVE');
});
it('cannot suspend a super-admin (409); quota below usage is 422; /admin/health lists the six queues', ...);
// create-super-admin.spec.ts: creates verified SUPER_ADMIN with argon2 hash; running twice promotes rather than duplicating
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(admin): super-admin console api with workspace and user suspension, quotas, health and bootstrap cli"`

---

### Task 18: Generic tenant-isolation test over every `/workspaces/{wid}` route (SP1 DoD)

**Files:**
- Create: `apps/api/test/isolation/tenant-routes.e2e-spec.ts`, `apps/api/test/isolation/exemptions.ts`
- Modify: `apps/api/src/openapi/export.ts` (export `listRoutes(app): { method, path }[]` from the Nest router)

**Interfaces:**
- Produces: `listRoutes(app)`; `exemptions.ts` exports `TENANT_ROUTE_EXEMPTIONS: { method: string; path: string; reason: string }[]` — must stay **empty** in SP1; later plans may only add entries with a reason reviewed in code review. The spec enumerates every route whose path starts with `/api/v1/workspaces/:wid` (probe routes excluded) and, for each, calls it as (a) an active `TEACHER` of another organisation and (b) a user with no membership, with a syntactically valid body (`{}`) and asserts `404 NOT_FOUND` — never 200/403/422 — and that an `auth.forbidden_workspace` audit row exists for case (a). It also asserts the enumeration found at least the routes this plan created (count ≥ 15) so a routing refactor cannot silently empty the suite.

- [ ] **Step 1: Write the failing spec** (as described; parametrised with `it.each`).
- [ ] **Step 2: Run to verify failure** — Expected: FAIL until `listRoutes` exists; any route answering other than 404 is a bug to fix in its task's code, not an exemption.
- [ ] **Step 3: Implement `listRoutes`** (walk `app.getHttpAdapter().getInstance()._router.stack` on Express 5 / use `app.getHttpServer()._events` fallback; keep method + path).
- [ ] **Step 4: Run to verify pass** — `pnpm --filter @nibras/api exec vitest run test/isolation` — Expected: every route 404 in both cases.
- [ ] **Step 5: Commit** — `git commit -am "test(api): generic tenant isolation suite over every workspace route"`

---

### Task 19: Web — auth screens (register, verify email, login + 2FA challenge, forgot/reset), session plumbing, gates (AC-AUTH-01, 05 UI; Review Focus 5)

**Files:**
- Create: `apps/web/src/lib/{session,auth-redirects}.ts`, `apps/web/src/components/{form,consent-gate,suspended-banner}.tsx`, `apps/web/src/app/[locale]/(auth)/layout.tsx`, `…/(auth)/{register,login,verify-email,forgot-password,reset-password,2fa,2fa/setup}/page.tsx`, `apps/web/src/app/[locale]/(app)/layout.tsx`, `…/(app)/app/page.tsx`, `apps/web/e2e/helpers/{mailpit,totp}.ts`, `apps/web/e2e/auth.spec.ts`
- Modify: `apps/web/src/lib/api.ts` (error → translated message helper `apiErrorMessage(t, body)`), `packages/i18n/messages/*.json` (namespaces `auth`, `errors`; `nav.skipToContent`, `nav.primary`), `apps/web/src/proxy.ts` (set `NEXT_LOCALE` from the `nibras_locale` cookie that the login/register pages set to `user.locale`), `packages/ui/src/app-shell.tsx` (+ `app-shell.test.tsx`; SP0 FIX-LATER a11y)

**Interfaces:**
- Produces:
  - `AppShellProps` gains `labels: { skipToContent: string; primaryNav: string }` (already-translated, like `nav[].label`); the shell renders, as its first child, `<a href="#main" className="sr-only focus:not-sr-only …">{labels.skipToContent}</a>`, then `<nav aria-label={labels.primaryNav}>`, and `<main id="main" tabIndex={-1}>`. French copy: `nav.skipToContent = "Aller au contenu"`, `nav.primary = "Navigation principale"`. The `(app)/layout.tsx` and SP0's `[locale]/page.tsx` pass the labels.
  - `getSession(): Promise<MeUser | null>` (server; `(await serverApi()).GET('/me')` — `serverApi()` is async and already forwards the cookie —, null on 401); `(app)/layout.tsx` redirects: no session → `/{locale}/login?next=`, `emailVerifiedAt == null` → `/{locale}/verify-email`, `twoFactor.required && !enabled` → `/{locale}/2fa/setup`; `pendingConsents.length > 0` → renders `<ConsentGate>` modal (blocking, lists the versions to accept, calls `POST /me/consents/{type}` for each, then refreshes); `status === 'SUSPENDED'` is unreachable (API 401s) → login page shows `errors.ACCOUNT_SUSPENDED`.
  - Pages (French copy from PRD): register with fields *Prénom, Nom, Email, Mot de passe, Langue* (pre-filled from the locale), *Fuseau horaire* (pre-filled from `Intl.DateTimeFormat().resolvedOptions().timeZone`, select with `Africa/Tunis`, `Africa/Algiers`, `Africa/Casablanca`, `Europe/Paris` on top then the IANA list — PRD §8.7.5), checkbox *J'accepte les CGU et la politique de confidentialité*; verify-email page: with `?token` calls `verify-email` then shows *Email vérifié* + link to the app; without token shows *Vérifiez votre email* and a *Renvoyer le lien* button; login with *Se souvenir de cet appareil* checkbox; on `TWO_FACTOR_REQUIRED` → `/2fa` page (6-digit code, link *Utiliser un code de secours*); `/2fa/setup`: QR (`qrcode` to data URL from `otpauthUrl`), secret in text, code input, then the 10 recovery codes with *Télécharger* (`.txt`) and a mandatory *J'ai enregistré mes codes* checkbox before *Continuer*; forgot: *Si un compte existe, un email a été envoyé* always; reset: new password, on `TOKEN_INVALID` → *Lien expiré* with a link to request a new one (AC-AUTH-06).
  - Error display: every API error code maps to `errors.<code>` (fallback `errors.INTERNAL_ERROR`); zod `details.issues` map to field errors; all form components from `@nibras/ui` (`Field`, `TextInput`, `Select`, `Checkbox`, `Alert` added to `@nibras/ui` here).
  - e2e helpers: `waitForEmail(to, templateHint): Promise<{ html: string; text: string; subject: string }>` polling Mailpit's API (`/api/v1/search?query=to:<to>`, then `/api/v1/message/<ID>`), `extractLink(html, pathContains)`, `totpCode(secret)` via otplib.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/ui/src/app-shell.test.tsx (+, @testing-library/react + jsdom already configured in @nibras/ui)
it('exposes a named navigation landmark and a skip link to #main', () => {
  render(<AppShell locale="fr" dir="ltr" nav={[]} labels={{ skipToContent: 'Aller au contenu', primaryNav: 'Navigation principale' }}>x</AppShell>);
  expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Aller au contenu' })).toHaveAttribute('href', '#main');
  expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
});
```

```ts
// apps/web/e2e/auth.spec.ts  (runs for projects chromium-fr and chromium-ar; locale from project metadata)
test('teacher signs up, verifies by email, lands on the dashboard', async ({ page, locale }) => {
  const email = `t-${Date.now()}@example.com`;
  await page.goto(`/${locale}/register`); await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  await page.getByLabel(t(locale, 'auth.register.firstName')).fill('Mohamed'); /* …lastName, email, password 'un mot de passe assez long' …*/
  await page.getByLabel(t(locale, 'auth.register.acceptTerms')).check(); await page.getByRole('button', { name: t(locale, 'auth.register.submit') }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/verify-email$`)); await expect(page.getByText(t(locale, 'auth.verify.pending'))).toBeVisible();
  const mail = await waitForEmail(email, 'verify-email'); await page.goto(extractLink(mail.html, '/verify-email?token=')!);
  await expect(page.getByText(t(locale, 'auth.verify.done'))).toBeVisible(); await page.getByRole('link', { name: t(locale, 'auth.verify.continue') }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/app$`)); await expect(page.getByRole('heading', { level: 1 })).toContainText('Mohamed');
  expect(await page.locator('body').innerText()).not.toMatch(/\b(auth|errors|common|nav)\.[a-zA-Z.]+\b/); // Review Focus 5
});
test('short password shows a translated field error, not a raw key', async ({ page, locale }) => { /* submit with 'short' → field error text equals t(locale,'errors.PASSWORD_TOO_SHORT') or the zod message key for min length */ });
test('login with 2FA: challenge page, wrong code error, right code enters; recovery code path', async ({ page, locale }) => { /* seed via API: register+verify, enable TOTP through /auth/2fa/setup + verify with request context; then UI */ });
test('AC-AUTH-05 UI: org admin without 2FA is forced to /2fa/setup and cannot leave before confirming', ...);
test('forgot/reset: expired link shows "Lien expiré" and a request-new link', ...);
test('consent gate blocks the app after a version bump until accepted', ...); // start the API for this test with CONSENT_VERSIONS override via env TEST_CONSENT_TERMS_VERSION read only when NODE_ENV!=='production'
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/ui test && pnpm --filter @nibras/web exec playwright test auth` — Expected: FAIL (`labels` prop missing; pages missing).
- [ ] **Step 3: Implement the pages, components and the two e2e projects** (`playwright.config.ts`: projects `chromium-fr`, `chromium-ar`, `mobile-fr` with `use.locale`; `webServer` additionally starts `pnpm --filter @nibras/api dev` and `pnpm --filter @nibras/worker dev` — turbo's `e2e` task now depends on `^build` (Task 0), so `@nibras/db`/`@nibras/contracts` dist exist when CI runs `pnpm turbo run e2e`).
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run test --filter=@nibras/ui --filter=@nibras/web --concurrency=2 && pnpm --filter @nibras/web e2e` — Expected: PASS in fr and ar.
- [ ] **Step 5: Commit** — `git commit -am "feat(web): registration, email verification, login with 2fa, password reset, consent gate and session plumbing"`

---

### Task 20: Web — settings: profile with timezone banner, security (2FA, devices), verification (phone + code of conduct), consents; onboarding checklist

**Files:**
- Create: `apps/web/src/app/[locale]/(app)/app/settings/{layout,profile/page,security/page,verification/page,consents/page}.tsx`, `apps/web/src/components/{timezone-banner,onboarding-checklist,devices-list}.tsx`, `apps/web/e2e/settings.spec.ts`
- Modify: `apps/web/src/app/[locale]/(app)/app/page.tsx` (dashboard shows the checklist), `packages/i18n/messages/*.json` (`settings`, `onboarding`)

**Interfaces:**
- Produces:
  - Settings nav (PRD §9.1): *Profil · Sécurité · Notifications (SP7) · Espace · Organisation · Données & confidentialité (SP11)* — only Profil, Sécurité, Vérification, Consentements and Espaces are live; others render *Bientôt disponible* placeholders.
  - Profile: first/last name, language, timezone (same selector as register), birth date; saving a new locale sets the `nibras_locale` cookie and navigates to the same page under the new locale. `TimezoneBanner`: when `Intl.DateTimeFormat().resolvedOptions().timeZone !== user.timezone` shows PRD §8.7.5 copy *Vous semblez être à {city} ; afficher en {tz} ?* with *Oui* (PATCH /me) / *Non* (dismiss, remembered in `localStorage` for 30 days).
  - Security: 2FA card (enable → same flow as `/2fa/setup`; disable with code; disabled button + explanation when `twoFactor.required`), password change form, `DevicesList` (device label, ip, last seen, *Cet appareil* badge, per-row *Déconnecter*, *Déconnecter partout* with confirm).
  - Verification: phone input (E.164, default country from `user.timezone` → TN/DZ/MA/FR), *Envoyer le code*, code input, status ticks for Email / Téléphone / Code de conduite; code-of-conduct text (`settings.coc.body`, builder's draft from D-O6) with checkbox + *J'accepte le code de conduite* → `POST /me/consents/CODE_OF_CONDUCT`.
  - Consents page: list with version/date, *Retirer* only for MARKETING.
  - `OnboardingChecklist` (PRD §8.1.3) on the dashboard while incomplete: *Votre espace est prêt à {done}/5* with items *Compléter mon profil (photo, matière, bio)* → `/app/settings/profile` (done when first/last name set and phone verified — avatar/subject arrive with SP3), *Vérifier mon email*, *Créer mon premier cours* → `/app/courses/new`, *Inviter mes étudiants* → `/app/students`, *Programmer ma première session* → `/app/sessions/new` (the last three link to routes later plans create; until then they render disabled with *Bientôt*). Hidden for users with no PERSONAL/teaching membership.

- [ ] **Step 1: Write the failing e2e tests**

```ts
test('profile: change language to ar flips the UI to RTL and persists; invalid timezone is impossible from the select', ...);
test('timezone banner appears when the browser tz differs and PATCHes on Oui', async ({ browser, locale }) => { const ctx = await browser.newContext({ timezoneId: 'Europe/Paris', storageState: tunisUserState }); /* expect banner text includes 'Europe/Paris'; click Oui; GET /me timezone === 'Europe/Paris' */ });
test('verification page: send OTP, read code from Mailpit (phone.otp_dev), verify, accept code of conduct → all three ticks green', ...);
test('security: devices list shows this device; "Déconnecter partout" logs out', ...);
test('onboarding checklist shows 2/5 after email verification and profile completion', ...);
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass** — Expected: PASS (fr + ar).
- [ ] **Step 5: Commit** — `git commit -am "feat(web): settings (profile, security, verification, consents), timezone banner and onboarding checklist"`

---

### Task 21: Web — workspaces: switcher, create organisation / personal workspace, settings, members, assignments, audit log; report-abuse button

**Files:**
- Create: `apps/web/src/components/{workspace-switcher,report-abuse-button,members-table,audit-log-table}.tsx`, `apps/web/src/app/[locale]/(app)/app/settings/workspaces/page.tsx`, `…/app/w/[wid]/{layout,settings/page,members/page,audit-log/page}.tsx`, `apps/web/e2e/workspaces.spec.ts`
- Modify: `apps/web/src/app/[locale]/(app)/layout.tsx` (switcher in the header; `SuspendedBanner` when the current workspace is `SUSPENDED`/`DELETING`), `packages/i18n/messages/*.json` (`workspace`, `members`, `abuse`)

**Interfaces:**
- Produces:
  - `WorkspaceSwitcher`: lists `/me/workspaces` (name, type badge *Personnel* / *Organisation*, role), current from the URL (`/app/w/[wid]`) or the first; shown only when > 1 (PRD §9.1 *[ Sélecteur d'espace ▾ ] (si plusieurs)*).
  - Workspaces settings page: *Créer une organisation* (name, country select TN/DZ/MA/FR/other, timezone) and *Créer mon espace personnel* (shown only when the user has no PERSONAL workspace; on `PERSONAL_WORKSPACE_FORBIDDEN` shows *{organizationName} n'autorise pas les espaces personnels*).
  - `/app/w/[wid]/settings`: name, default timezone/locale, `allow_personal_workspaces` toggle (organisation only, with the PRD note that existing personal workspaces are unaffected), the §8.2.1 settings form (windows, grace, thresholds, defaults), storage usage bar, *Transférer la propriété* (owner, organisation: select among admins + confirm), *Supprimer l'espace* (owner, type-the-name confirm).
  - `/app/w/[wid]/members`: table (name, email when visible, role, can_teach, status, joined), filters by role/status/search; admin actions: change role (ADMIN/TEACHER), toggle *Peut enseigner*, *Retirer* (confirm; on `MEMBER_HAS_FUTURE_SESSIONS` show the list from `details.items`); assignments panel (organisation): pick teacher → multi-select students → *Affecter*; students tab shows *Invitation en attente* placeholder linking to SP2's `/app/students`.
  - `/app/w/[wid]/audit-log`: table (date in the viewer timezone via `@nibras/i18n` `formatDate`, actor, action, entity, before→after as a compact diff), filters, cursor pagination.
  - `ReportAbuseButton({ workspaceId, entityType, entityId })`: *Signaler* → dialog with category select (labels: *Harcèlement, Contenu inapproprié, Usurpation d'identité, Sécurité d'un mineur, Autre*), description, submit → toast *Signalement envoyé*. Used here on a member row (entity USER); later plans mount it in rooms, messages, courses.
  - `SuspendedBanner`: *Cet espace est suspendu : {reason}. Lecture seule.*

- [ ] **Step 1: Write the failing e2e tests**

```ts
test('create an organisation, get forced to 2FA setup, then see it in the switcher', ...);
test('members: owner changes a teacher to admin with can_teach, assigns two students, teacher sees only them', ...);
test('AC-WS-08 UI: invited teacher sees "Créer mon espace personnel"; forbidden org name shown when disallowed', ...);
test('audit log shows member.role_changed with before/after and dates in the viewer timezone', ...);
test('report abuse on a member creates a report and shows the toast; the dialog is RTL in ar', ...);
test('suspended workspace shows the banner and disables mutations', ...);
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass** — Expected: PASS (fr + ar).
- [ ] **Step 5: Commit** — `git commit -am "feat(web): workspace switcher, organisation and personal workspace creation, settings, members, assignments, audit log, report abuse"`

---

### Task 22: Web — super-admin console (workspaces, abuse reports queue, user suspension)

**Files:**
- Create: `apps/web/src/app/[locale]/(admin)/admin/{layout,workspaces/page,abuse-reports/page,abuse-reports/[id]/page}.tsx`, `apps/web/e2e/admin.spec.ts`
- Modify: `packages/i18n/messages/*.json` (`admin`)

**Interfaces:**
- Produces: `/admin` layout guarded by `platformRole === 'SUPER_ADMIN'` (else 404 page); nav *Espaces · Signalements · Santé*. Workspaces table (type, name, members, storage used/quota, status, created) with *Suspendre* (reason required) / *Réactiver* / *Quota* (GiB input). Abuse reports queue with filters (status, category, workspace), `MINOR_SAFETY` rows highlighted and pinned first; detail page: category, description, reporter, frozen snapshot (JSON viewer), status select (`OPEN → IN_REVIEW → RESOLVED | DISMISSED`), resolution text, *Suspendre ce professeur* (when the entity is a USER with a teaching membership; reason required) and *Réactiver*. Health page: queues table from `/admin/health`.

- [ ] **Step 1: Write the failing e2e tests** — `test('super-admin suspends a workspace from the console; member sees the banner')`, `test('abuse queue: MINOR_SAFETY first; resolve a report; suspend the reported teacher with reason')`, `test('non super-admin gets 404 on /admin')`.
- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(web): super-admin console for workspaces, abuse reports and teacher suspension"`

---

### Task 23: End-to-end smoke (FR + AR), OpenAPI regeneration, runbooks, CI wiring

**Files:**
- Create: `apps/web/e2e/smoke.spec.ts`, `docs/runbooks/auth-and-tenancy.md`
- Modify: `packages/contracts/openapi/openapi.json`, `packages/contracts/src/generated/api.d.ts` (regenerated), `.github/workflows/ci.yml` (e2e job: `pnpm --filter @nibras/api cli create-super-admin …` before Playwright; `JWT_SECRET`/`TOTP_ENCRYPTION_KEY` and the other SP1 variables are already CI-only dummies in the workflow `env` — no secrets to add), `docs/runbooks/local-dev.md`, `.env.example` (only if a task introduced a variable beyond the pre-added SP1 set; then `turbo.json` and CI `env` in the same commit)

**Interfaces:**
- Produces: `smoke.spec.ts` — one scenario per locale (fr, ar) on the mobile project: teacher registers → verifies → verifies phone (OTP from Mailpit) → accepts the code of conduct → creates an organisation → is forced through 2FA setup → invites nobody (SP2) but assigns roles to a seeded admin → super-admin (seeded by the CLI in `globalSetup`) suspends and reactivates the organisation → teacher sees and then loses the banner. Runbook: how to create the first super-admin, rotate `JWT_SECRET` (invalidates all sessions) and `TOTP_ENCRYPTION_KEY` (requires re-sealing secrets — document as a migration script to write when first needed), what each audit action means, how to unlock a locked account (delete the Redis `login:lock:*` key), how to read OTP codes in dev (Mailpit), the tenant-isolation suite and the exemptions rule.

- [ ] **Step 1: Write the failing smoke test** (both locales, asserts `dir`, no raw keys on every visited page).
- [ ] **Step 2: Run to verify failure** — Expected: FAIL only on the not-yet-wired `globalSetup` seeding.
- [ ] **Step 3: Implement `globalSetup`, regenerate OpenAPI + client, update CI and runbooks.**
- [ ] **Step 4: Run everything** — `pnpm turbo run lint typecheck test build --concurrency=2 && pnpm --filter @nibras/db migrate:check && pnpm turbo run e2e --concurrency=1` locally (run the test task twice to confirm the per-package databases do not interfere), then push: CI `check`, `windows-check`, `migrate-check`, `e2e` green; `git diff --exit-code packages/contracts` clean after regeneration; `grep -c '"TEST_DB_PREFIX"' turbo.json` = 1 (strict-env list intact).
- [ ] **Step 5: Commit** — `git commit -am "test(e2e): fr/ar smoke for auth, verification, organisation and suspension; openapi regenerated; runbooks"`

---

## Self-review notes (performed while writing; re-run on 2026-10-11 after reconciling with SP0 as merged)

- **SP0 reconciliation (2026-10-11):** every consumed name was checked against `main` — `createPrismaClient(url?)`, `systemPrisma()`, `resetDatabase(client?)` with the `_test` guard, `ApiError(status, code, message, details?)`, `RequestContext.get()/run()` + `RequestStore`, `createTestApp({ overrides?, controllers? }) → { app, http, logs }`, `QUEUES`/`DEFAULT_JOB_OPTIONS`/`ERROR_CODES` (with `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`)/`REDACT_KEYS`/`redactPaths`/`createApiClient(baseUrl incl. /api/v1)`/`dirOf` in `@nibras/contracts`, `ProcessorRegistry.registerProcessor`, `REDIS` token, `serverApi()` async with header forwarding, `TRUST_PROXY_HOPS`, `applyTestEnv`. Every `prisma migrate dev` invocation became the `migrate:dev -- --name <x> --create-only` / `pnpm db:migrate` / `pnpm db:migrate:test` triple; `nibras_test` no longer appears. SP0 carry-overs are Task 0 (redaction keys + scoped paths, single-source `nibras_<pkg>_test` derivation with `TEST_DB_PREFIX`/`TEST_REDIS_DB_BASE`, `e2e` → `^build`, `env.ts` comment, staging caveats) and FIX-LATER items landed in Task 2/5 (`onPrismaLog` → pino, `MetricsMiddleware`, `REDIS_URL` protocol, type-aware `no-floating-promises`), Task 4 (`argon2` in `onlyBuiltDependencies`), Task 19 (`AppShell` landmark + skip link). `SMS_PROVIDER` is `console` (the value already in `.env.example`/CI), mapped to `LogSmsProvider`. One-time-code fields are `otpCode`/`recoveryCode` everywhere (Tasks 3, 10, 12) so the `code` key could leave `REDACT_KEYS`.
- **Spec coverage against PRD §18 SP1 DoD:** AC-AUTH-01/02 (Task 6), 03 (8), 04/07 (7), 05 (10, 19), 06 (9, 19); AC-WS-01/03/06 (13), 02/05 (15), 04/08 (14, 21), 07 (2); AC-GDPR-05 (2, 5), 06 (11, 19); AC-SAFE-01 at guard level (12 — consumers in SP2/3/6), 03 via `isEntityUnderReview` (16 — consumer SP8), 04 SP1 part (17 — session cancellation via `UserSuspendedEvent` in SP5/6), 05 (16); generic isolation suite on every tenant route (18); `allow_personal_workspaces` (14); super-admin console (17, 22); language/timezone preferences (11, 20); abuse report API + processing queue (16); phone OTP + code of conduct (12, 20); audit log (5, 14, 21); Prisma extension + RLS (2). Entities: all nine from §18 SP1 plus `TeacherProfile` table (endpoints deferred to SP3 because the profile needs avatar media).
- **Type consistency:** `tenantDb`, `crossTenantDb`, `withTenantTx`, `onPrismaLog`/`PrismaLogHandler`, `AuditService.log`, `QueueService.add`, `createTestApp` → `{ app, http, logs, db, email, sms, queue, pwned, reset }`, `loginAs`/`as`, `testDbName`/`testRedisDb`/`applyTestEnv`, `REDACT_SCOPED_PATHS`, `AppShellProps.labels`, `createUser`/`createOrganization`/`createPersonalWorkspace`/`grantConsents`, `MembershipService.addMember`, `MEMBER_REMOVAL_BLOCKERS`, `SnapshotRegistry.register`, `requiresTwoFactor`, `VerificationService.status`, `grantFor`, `WorkspaceSettingsSchema`, `CONSENT_VERSIONS`, `MeUser` are spelled identically wherever referenced.
- **Review Focus:** the five lines each have a named test in Tasks 6/7 (email normalisation), 10 (2FA bypass), 6/11 (timezone/locale/birth date), 15/16/11 (cross-tenant aggregates and lookups), 3/19 (RTL and translations).
- **Proportion:** 24 tasks (0–23); tests carry the spec's exact values; code steps are signatures and pinned values only. Review Focus task numbers are unchanged by the insertion of Task 0.
