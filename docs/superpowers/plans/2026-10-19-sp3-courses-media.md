# SP3 — Courses, Content & Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use **superpowers:subagent-driven-development** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Model policy (owner decision, overrides the skill's default tiers):** every implementer, task reviewer, re-reviewer and fixer subagent runs on **Opus** (`model: "opus"`). Changes to this plan, the spec or the architecture go back to **Fable** (`model: "fable"`). Always pass the model explicitly when dispatching.
>
> **Prerequisite:** `main` with SP2 merged (`sp2/students-invitations`, itself on top of SP1.6). Branch `sp3/courses-media` from that `main`. This plan consumes SP0/SP1/SP1.5/SP1.6/SP2 interfaces exactly as they exist there:
>
> - `@nibras/db`: `TENANT_MODELS` (`src/tenancy.ts`), `CROSS_TENANT_LOOKUP_KEYS` (SP2, `src/tenant.ts`), `db`, `tenantDb(wid)`, `withTenantTx(wid, fn)` (`TenantTx`), `crossTenantDb()` (`hasUserOrIdFilter` + lookup keys; no `include`/`select` into a tenant relation), `systemPrisma()`, `resetDatabase`, `uuidv7`, `Prisma.sql`; migration conventions (`identity_tenancy_constraints` hand-written section; RLS pair + `tenant_isolation` policy with `NULLIF` in `rls_and_audit_privileges`; SP2's `students_invitations` migration as the latest example); `packages/db/src/schema.test.ts` pattern.
> - `apps/api`: `ApiError(status, code, message, details?)`; global guards `RateLimitGuard → JwtAuthGuard → AccountGatesGuard → SuperAdminGuard → WorkspaceContextGuard → PermissionGuard → TeacherVerifiedGuard`; decorators `@Public()`, `@CurrentUser()`, `@RequirePermission(p)`, `@RequireVerifiedTeacher()`, `@CrossTenant()`; `currentGrant(p)`, `assertOwn(ownerUserId)`, `permissionDenied()` (`src/tenancy/permissions.ts`); `workspaceContext()` (`src/workspaces/workspace-context.ts`); `memberCtx(wid)` / `MemberCtx` and `MembersService.ownScope` (SP2 made it reachable) (`src/members/members.service.ts`); `lockWorkspace(tx, wid)`, `readSettings(w)` (`src/workspaces/workspace-settings.service.ts`); `validationFailed(path, msg)` (`src/workspaces/workspaces.service.ts`); `AuditService.log({ action, entityType, entityId?, workspaceId?, before?, after? })` + closed `AuditAction` union; `QueueService.add(queue, name, data, opts?)` + `FakeQueueService.jobs`; `hitWindow(redis, key, windowS)` / `rateLimited()` (`src/auth/rate-window.ts`), `REDIS` token; `RequestContext`; `ProvidersModule` tokens (`EMAIL_PROVIDER`, …) and `createXProvider(env)` factories; `env` (`src/config/env.ts`: `EnvObject.transform(...).superRefine(...)`); `configureApp(app)`; SP2 events in `src/members/events.ts` (`INVITATION_ACCEPTED` / `InvitationAcceptedEvent(workspaceId, invitationId, userId, role)`, `MEMBERSHIP_ACTIVATED`, `MEMBERSHIP_DEACTIVATED`) and SP2's `join.service.ts`, `students.service.ts` (`StudentSummary.courses: []`, `progressPercent: null`, `StudentProfile.courses: []`, `progress: null`), SP2's status → code mapping (`403 GUARDIAN_CONSENT_REQUIRED` for the three consent statuses, `403 MEMBERSHIP_INACTIVE` otherwise); test helpers `createTestApp()` → `{ app, http, logs, db, email, sms, queue, pwned, reset }`, `loginAs`, `as`, `createUser`, `createOrganization`, `createPersonalWorkspace`, `addMember`, `assign`, `DEFAULT_PASSWORD`; isolation suite `test/isolation/{tenant-routes.e2e-spec.ts,fixtures.ts,exemptions.ts}` with `FOREIGN_PARAMS`, `FOREIGN_QUERIES`, `FOREIGN_BODIES`, `BODYLESS_WRITE_ROUTES`; `listRoutes(app)`.
> - `apps/worker`: `WorkerModule.register(env, logger)`, `ProcessorRegistry.registerProcessor(queue, jobName, handler)`, `QueueRegistry.queues` (bullmq `5.81.5`, `upsertJobScheduler`), `WORKER_DB`, `EMAIL_PROVIDER`, `WORKER_ENV`, `WORKER_LOGGER`, SP2's `schedulers.ts` + `system-audit.ts` (`writeSystemAudit`), `AbuseProcessor` `sentTo` progress pattern, `test/abuse.e2e-spec.ts` pattern (fake `Job`, `overrideProvider(EMAIL_PROVIDER)`), `test/redis.ts` `obliterateAllQueues()`.
> - `@nibras/contracts`: `ERROR_CODES`, `QUEUES`, `DEFAULT_JOB_OPTIONS`, `DAILY_SCHEDULER_PATTERN` (SP2), `PERMISSIONS` / `grantFor`, `LocaleSchema`, `WorkspaceSettingsSchema`, `MembersQuerySchema` pagination shape (`{ items, nextCursor }`), `PLACEHOLDER_SECRETS` / `isPlaceholderSecret` / `assertDeployableEnv` (`src/env-placeholders.ts`), the zod-free `src/web.ts` entry, `createApiClient`, generated `src/generated/api.d.ts` + `openapi/openapi.json` (`pnpm --filter @nibras/api openapi:export && pnpm --filter @nibras/contracts generate`; CI fails on drift).
> - `@nibras/providers`: `EMAIL_TEMPLATE_KEYS` + `EmailParamsByKey` + `renderEmail` + `InMemoryEmailProvider` (`findByTemplate`, `failFor`); templates test over `EMAIL_TEMPLATE_KEYS × LOCALES` with `SAMPLE_PARAMS`; `packages/providers` has no DB and no Redis today (its vitest config is plain).
> - `@nibras/i18n`: `messages/{fr,ar,en}.json`, sync test, unused-key guard (`src/unused-keys.test.ts` scans `apps/web/src` and `packages/ui/src`), `formatDate`, `formatNumber`.
> - `apps/web`: `api` / `serverApi()` / `asApiResult` (`src/lib/api.ts`), `useAbortableQuery`, `useSubmit`, `useToast`, `apiErrorMessage`, `issuesToFieldErrors`, `getSession()`, `buildNavModel` (`src/lib/navigation.ts`), `WorkspaceTabs` (`app/w/[wid]/workspace-tabs.tsx`), `OnboardingChecklist`, `MembersPanel`, SP2's `StudentsPanel` / `StudentProfilePanel`, `buildCsp` / `securityHeaders` (`src/lib/security-headers.ts`), `proxy.ts`, `scripts/first-load-js.mjs` (`BUDGET_BYTES = 250_000`); `@nibras/ui` components (`Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `Field`, `Badge`, `Alert`, `Card`, `Table`, `Dialog`, `AlertDialog`, `Sheet`, `DropdownMenu`, `Tabs`, `EmptyState`, `PageHeader`, `Skeleton*`, `Spinner`, `useSubmit`); e2e helpers `seedUser`, `addOrgMember`, `uiLogin`, `apiLogin`, `t(locale, key)`, `toast()`, `appUrl`, SP2's invitation/student seeds, projects `chromium-fr`, `chromium-ar`, `mobile-fr`, `mobile-ar`, `a11y.spec.ts` `audit(page, testInfo, name)`, Playwright `page.clock` (≥ 1.45).
> - Infra: `docker-compose.yml` (MinIO `pgsty/minio:RELEASE.2026-08-04T00-00-00Z@sha256:…`, root `minioadmin`), `infra/compose.staging.yml` (per-service `environment:` since SP1.6 T8; `minio` service), `packages/config/infra/compose-staging.test.ts` (asserts `api` has no `S3_*` — relaxed by T4), `.github/workflows/ci.yml` (`check` job env + services; actions SHA-pinned), `turbo.json` strict env, `packages/config/vitest/test-env.mjs` (`applyTestEnv(pkg, env)`), `.env.example`, runbooks `docs/runbooks/{local-dev,staging,auth-and-tenancy,frontend,students-and-invitations}.md`.
>
> **Execution notes (owner rulings carried from SP0 → SP2, plus this plan's):**
>
> - **Disk:** tasks run **serially in the main checkout, in order T0 → T18** — no worktrees, no second `node_modules`, one implementer at a time. Dependency notes exist for review only.
> - Every turbo invocation uses `--concurrency=2`. Single specs run with `pnpm --filter <pkg> exec vitest run <path>`.
> - **DB workflow (T1 only):** `pnpm --filter @nibras/db migrate:dev -- --name courses_media --create-only` → append the hand-written SQL → `pnpm db:migrate` → `pnpm db:migrate:test` → `pnpm --filter @nibras/db migrate:check`. Never call `prisma migrate dev` directly.
> - **Turbo strict env:** this plan adds `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_BUCKET_TEST`, `S3_FORCE_PATH_STYLE`, `VIDEO_PROVIDER`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_API_TOKEN`, `CLOUDFLARE_STREAM_WEBHOOK_SECRET`, `CLOUDFLARE_STREAM_SIGNING_KEY_ID`, `CLOUDFLARE_STREAM_SIGNING_KEY_PEM`, `CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN` (test env) and `MEDIA_ORIGINS` (build env). Each goes to `turbo.json`, `.github/workflows/ci.yml` `env` and `.env.example` in the same commit (T2, T4, T16).
> - **MinIO in tests (spec D10):** `pnpm test` for `@nibras/providers`, `@nibras/api`, `@nibras/worker` needs the compose MinIO (`docker compose up -d`, already required for Postgres). Each package uses its own bucket `nibras-<pkg>-test` (derived by `applyTestEnv` from `S3_BUCKET_TEST`, T2), created on demand and emptied by the suite's `reset()`. CI starts the pinned MinIO image in a step (T2). The `windows-check` job keeps running only the DB-free packages: `@nibras/providers` tests that need MinIO are skipped there through `S3_ENDPOINT` being unset (`describe.skipIf(!process.env.S3_ENDPOINT)`).
> - **Dependencies pinned exactly** when added (versions seen on 2026-10-19 with `pnpm view <pkg> version`; if a newer **patch** exists at implementation time, pin it and note it in the commit body): `@aws-sdk/client-s3@3.1152.0`, `@aws-sdk/s3-request-presigner@3.1152.0`, `file-type@22.2.0`, `pdf-lib@1.17.1`, `image-size@2.0.4` (api/worker/providers); `tus-js-client@4.3.1`, `hls.js@1.7.3`, `pdfjs-dist@6.4.299`, `@tiptap/react@3.32.0`, `@tiptap/core@3.32.0`, `@tiptap/pm@3.32.0`, `@tiptap/starter-kit@3.32.0`, `@tiptap/extension-link@3.32.0`, `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2` (web). `jose` (already in the API) signs the Cloudflare playback JWT. No other runtime dependency.
> - i18n: every new key is added to `fr`, `ar`, `en` in the same commit; `pnpm --filter @nibras/i18n test` is part of the verification of any task touching `apps/web`, `packages/providers` or `packages/i18n`.
> - OpenAPI: any task that adds or changes a route regenerates `packages/contracts/openapi/openapi.json` + `src/generated/api.d.ts` in the same commit (`git diff --exit-code packages/contracts` after regeneration must be clean at the end of the task).
> - Secret naming rule (SP1): raw tokens never appear in job payloads, audit rows or logs. Presigned URLs and playback tokens are bearer secrets too: the API never logs response bodies today (kept), audit rows carry ids only, and T7 asserts that no `X-Amz-Signature` / playback URL reaches `logs.lines()`.

**Goal:** A verified teacher (or organisation admin) builds a course of modules and VIDEO / PDF / TEXT lessons in a drag-and-drop editor with optimistic locking, uploads media that resumes after a dropped connection (S3 multipart locally and on OVH, tus on Cloudflare Stream) and goes through signature checks, quotas and a state machine driven by jobs and signed webhooks; publishes, archives and deletes within the PRD rules; assigns students (also from SP2's invitation and invite-link `courseIds`); and a student sees only his published courses, behind module and sequential locks, watching video and reading PDFs through 2-hour bearer tokens and 5-minute inline URLs with a visible, moving watermark — fully testable locally and in CI with MinIO alone.

**Architecture:** `packages/db` gains `Course`, `Module`, `Lesson`, `MediaAsset`, `Enrollment`, `LessonProgress` (🏢, RLS) and `WebhookEvent`, plus deferrable position constraints and the lesson content check. `packages/contracts` gains the schemas, error codes, limits, the rich-text whitelist schema and job constants. `packages/providers` gains `StorageProvider` (`S3StorageProvider`, `InMemoryStorageProvider`), `VideoProvider` (`S3VideoProvider`, `CloudflareStreamProvider`, `FakeVideoProvider`), the MP4 probe and three email templates. `apps/api` gains modules `courses` (lifecycle, locking, reassign), `structure` (modules, lessons, reorder, rich text), `media` (uploads, complete, playback, download, delete, webhooks), `enrollments` (batch, revoke, SP2 hooks, notify jobs) and `learn` (`/me` routes, locks, minimal progress), the `If-Match` interceptor, env and provider wiring, isolation fixtures. `apps/worker` gains the media processors and schedulers, the course notification processor and the course purge. `apps/web` gains the course list and editor (dnd-kit, Tiptap, uploads with resume), the enrollment panel, the student course and lesson pages, the lazy video player and PDF viewer, the watermark, nav entries and the `MEDIA_ORIGINS` CSP.

**Tech Stack additions (pin exactly, see execution notes):** AWS SDK v3 S3 + presigner, `file-type`, `pdf-lib`, `image-size` (server); `tus-js-client`, `hls.js`, `pdfjs-dist`, Tiptap 3, dnd-kit (web).

**Spec:** `docs/superpowers/specs/2026-10-19-sp3-courses-media-design.md` → `PRD.md` v2.1 §4.1 D-O8, §4.2 D-P1/D-P8/D-P14/D-P15/D-P20, §7, §8.4, §8.5, §8.6, §9.1/9.3/9.5, §10.5/10.7/10.8/10.9, §11.1/11.3, §12.1/12.3, §13.4/13.5, §14.1/14.7, §15.4, §15.5, §18 sub-project **3**.

## Global Constraints

Everything in SP0 → SP2's Global Constraints still applies. In addition:

- **Definition of done (sub-project):** AC-CRS-01…05, AC-MED-01…09, AC-ENR-01…03, 05 automated (API e2e; Playwright for AC-CRS-03/04, AC-MED-01 (small file, forced interruption), AC-MED-09, AC-ENR-03 UI); the upload-resume test and the webhook-idempotence test (PRD §18); `pnpm turbo run lint typecheck test build --concurrency=2` green; `pnpm format:check` green; `pnpm --filter @nibras/db migrate:check` green; `pnpm --filter @nibras/web budget` green (every route < 250 kB gzip — the player, viewer, editor and dnd are dynamic imports); `pnpm --filter @nibras/web e2e` green locally and in CI (`E2E_PROD=1`); `pnpm audit --prod --audit-level=high` exit 0; OpenAPI drift check green; axe serious/critical = 0 on every new page in `chromium-fr`, `chromium-ar`, `mobile-ar`; runbook `docs/runbooks/courses-and-media.md` written; the security workflow green (new actions pinned).
- Owner-locked rules (PRD §22) this plan must not reinterpret: D-O8 (bearer tokens 2 h + visible watermark, no DRM, no user-bound proxy), D-P8 (progress formula; SP3 implements its manual-completion subset exactly), D-P15 (limits and quotas), D-P14 (`If-Match` → `409 VERSION_CONFLICT`), D-P20 (optimistic locking only), the §7 « Cours » rows, §8.4.1 deletion rule (DRAFT/ARCHIVED only, no ACTIVE enrollment, soft 30 days), §8.5.1 access rule, §8.5.2 lock rules, D-O6 (verified teacher before uploading/publishing).
- **Stable identifiers introduced here** (spelled identically across tasks): error codes of spec §7 (`VERSION_REQUIRED` … `WEBHOOK_SIGNATURE_INVALID`); constants `MEDIA_LIMITS = { VIDEO: { maxBytes: 4 GiB, maxDurationS: 14400 }, PDF: { maxBytes: 50 MiB }, IMAGE: { maxBytes: 5 MiB }, FILE: { maxBytes: 10 MiB } }`, `MEDIA_MIME_TYPES` (per kind), `S3_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm']`, `UPLOAD_PART_SIZE_BYTES = 8 MiB`, `UPLOAD_URL_TTL_S = 3600`, `UPLOAD_PARTS_PER_BATCH = 100`, `PLAYBACK_TTL_S = 7200`, `INLINE_URL_TTL_S = 300`, `PLAYBACK_TOKENS_PER_HOUR = 30`, `UPLOAD_ABANDON_AFTER_MS = 24 h`, `PROCESSING_TIMEOUT_MS = 6 h`, `COURSE_PURGE_AFTER_DAYS = 30`, `MEDIA_STATUS_POLL_MS = 5000`, `WATERMARK_MOVE_MS = 30_000`, `ENROLL_BATCH_MAX = 200`, `RICH_TEXT_MAX_BYTES = 200_000`, `RICH_TEXT_MAX_DEPTH = 20`, `MVP_LESSON_TYPES = ['VIDEO','PDF','TEXT']`, `MVP_UNLOCK_RULES = ['NONE','PREVIOUS_MODULE_COMPLETED']`, `WEBHOOK_TOLERANCE_S = 300`; jobs `MEDIA_PROCESS_JOB = 'media.process'`, `MEDIA_WEBHOOK_PROCESS_JOB = 'media.webhook.process'`, `MEDIA_CLEANUP_JOB = 'media.cleanup_abandoned'`, `MEDIA_DELETE_JOB = 'media.delete'`, `COURSE_ASSIGNED_NOTIFY_JOB = 'course.assigned_notify'`, `COURSE_PUBLISHED_NOTIFY_JOB = 'course.published_notify'`, `COURSE_PURGE_JOB = 'course.purge_deleted'`, job ids `mediaProcessJobId(id) = 'media:{id}:process'`, `mediaDeleteJobId(id) = 'media:{id}:delete'`, `webhookProcessJobId(id) = 'webhook:{id}'`, `coursePublishedNotifyJobId(courseId, version)`, scheduler ids `media-cleanup-abandoned` (`HOURLY_SCHEDULER_PATTERN = '15 * * * *'`), `course-purge-deleted` (`'30 3 * * *'`); env `VIDEO_PROVIDER: 's3' | 'cloudflare_stream'`; tokens `STORAGE_PROVIDER`, `VIDEO_PROVIDER_TOKEN` (API and worker); events `COURSE_ASSIGNED`, `COURSE_PUBLISHED`, `ENROLLMENT_REVOKED`, `INVITE_LINK_JOINED`; helpers `probeMp4`, `detectSignature`, `storageKeyFor`, `resolveCourseAccess`, `resolveLessonAccess`, `LockService`, `ProgressService.recompute`, `IfMatch` decorator + `ifMatchVersion()`, `expectStructureInvariant(db, courseId)` (positions 1..n contiguous per parent; versions ≥ 1), `expectQuotaInvariant(db, wid)` (`storageUsedBytes` = Σ `countedBytes` of non-deleted assets).
- **Permissions** (no new `PERMISSIONS` entries): see spec §7. Scope `own` on `course.manage` / `course.delete` / `course.media.manage` / `enrollment.manage` / `pdf.download` / `progress.read` = `Course.ownerUserId === me` (media: `MediaAsset.ownerUserId === me` or a referencing course is mine); `enrollment.manage` own additionally requires every target student to be assigned to the caller. STUDENT and GUARDIAN memberships get `403 PERMISSION_DENIED` on every `/workspaces/{wid}/courses|media` route (the service checks `membership.role`; the matrix gives them `course.read: all`, which only the `/me` routes consume).
- **Versioning:** `Course.version` is bumped by every mutation of the course, its modules and its lessons (one `UPDATE … SET version = version + 1` inside the same `withTenantTx`), `Module.version` by its own and its lessons' mutations, `Lesson.version` by its own. PATCH/reorder routes require `If-Match: "<Course.version>"` (quoted or bare integer; anything else → `428 VERSION_REQUIRED`); mismatch → `409 VERSION_CONFLICT { currentVersion }`. GET detail/structure responses carry `ETag: "<Course.version>"`.
- **Error shape:** services throw `ApiError`; a resource of another workspace is `404 NOT_FOUND` (tenant scoping, never 403); a lock is `403` with `details.reason`.
- UI copy: French strings quoted from the PRD are verbatim (« Terminez le module {n} », « en cours de traitement », « Vous n'avez plus accès à ce cours », « Archiver puis supprimer », « Marquer comme terminé », « Annuler terminé », « Reprendre l'envoi »); AR/EN are the builder's translations.

## Review Focus

Seven failure modes the spec implies but no acceptance criterion exercises directly; each has its test in the owning task.

1. **Version bump race** — two concurrent lesson creations under the same `If-Match` must yield exactly one `201` and one `409` (the version check and the bump happen under `SELECT … FOR UPDATE` on the course row). → T6.
2. **Quota overshoot by parallel uploads** — three `POST /media/uploads` of 10 GiB declared on a 20 GiB workspace: the third is `402`; and a `complete` whose actual size pushes usage over the quota is refused and the object deleted (`expectQuotaInvariant`). → T7.
3. **Signature bypass through the declared mime** — an upload declared `application/pdf` whose first bytes are `MZ` is rejected at `complete` and the object is gone from MinIO; a `.pdf` declared as `image/png` is also rejected (`MEDIA_KIND_MISMATCH`). → T7.
4. **Lock evaluation across optional modules** — module 3 with `PREVIOUS_MODULE_COMPLETED` after an optional module 2 and a complete module 1 is unlocked; after an incomplete non-optional module 1 it is locked even when module 2 is complete; sequential lessons never block on an optional lesson. → T10.
5. **Foreign media in a body** — `mediaAssetId` of workspace B on a lesson of A, `coverMediaId` of B, an image `mediaId` of B inside `content` → `404`/`422`, never `2xx`; the structure of A never references B (`expectStructureInvariant`). → T6, T5.
6. **Webhook replay and forgery** — a valid body replayed → `200 { duplicate: true }` and no second job; a body with a stale `time` (> 300 s) or a wrong `sig1` → `401` and no `WebhookEvent` row; a `ready` for an asset already `FAILED` leaves it `FAILED`. → T7, T8.
7. **Student reaching a DRAFT or unpublished course** — after `unpublish`, `GET /me/courses/{cid}` and `/me/lessons/{lid}` and `playback` answer `403 COURSE_NOT_AVAILABLE`; `GET /me/courses` no longer lists it; the enrollment row and progress are unchanged (AC-CRS-02, AC-ENR-02 negative side). → T10.

---

## File Structure

```
packages/contracts/src/{course-constants,media-constants,rich-text,courses,structure,media,enrollments,learn}.ts (+ .test.ts)   (T0)
packages/contracts/src/{error-codes,queues,index,web,env-placeholders}.ts                                                   (T0, T2)
packages/db/prisma/schema.prisma + migrations/<ts>_courses_media/migration.sql  src/{tenancy,tenant}.ts  src/{schema,tenant}.test.ts   (T1)
packages/providers/src/storage/{types,s3,in-memory,keys}.ts (+ s3.test.ts, in-memory.test.ts)  package.json  vitest.config.ts  test-setup.ts   (T2)
packages/config/vitest/test-env.{mjs,d.mts,test.ts}  turbo.json  .github/workflows/ci.yml  .env.example  docker-compose.yml (unchanged)   (T2)
packages/providers/src/video/{types,s3-video,cloudflare-stream,fake,mp4-probe}.ts (+ tests, fixtures/)  src/index.ts        (T3)
apps/api/src/config/env.ts (+ .spec.ts)  src/providers/providers.module.ts  src/main.ts  test/helpers/app.ts  scripts/s3-init.mjs  package.json   (T4)
apps/worker/src/{env,providers,worker.module}.ts (+ env.test.ts)  infra/compose.staging.yml  packages/config/infra/compose-staging.test.ts  docs/runbooks/staging.md   (T4)
apps/api/src/common/if-match.ts (+ .spec.ts)  src/courses/{courses.module,courses.controller,courses.service,course-access,dto}.ts  test/courses/courses.e2e-spec.ts  test/isolation/fixtures.ts   (T5)
apps/api/src/structure/{structure.module,modules.controller,lessons.controller,structure.service,rich-text.service,dto}.ts  test/structure/*.e2e-spec.ts  test/helpers/invariants.ts   (T6)
apps/api/src/media/{media.module,media.controller,media.service,upload.service,playback.service,signature,quota.service,webhooks.controller,dto}.ts  test/media/*.e2e-spec.ts   (T7)
apps/worker/src/processors/media.processor.ts  src/media/{process,cleanup,delete}.ts  src/schedulers.ts  test/media.e2e-spec.ts  packages/providers/src/email/types.ts (media.failed)  packages/i18n/messages/*.json   (T8)
apps/api/src/enrollments/{enrollments.module,enrollments.controller,enrollments.service,enrollment-hooks.listener,events,dto}.ts  src/invite-links/join.service.ts (event)  src/students/students.service.ts  test/enrollments/*.e2e-spec.ts   (T9)
apps/worker/src/processors/course-notify.processor.ts  test/course-notify.e2e-spec.ts  packages/providers/src/email/types.ts (course.assigned, course.published)   (T9)
apps/api/src/learn/{learn.module,learn.controller,learn.service,access,lock.service,progress.service,dto}.ts  test/learn/*.e2e-spec.ts   (T10)
apps/web/src/lib/navigation.ts  src/app/[locale]/(app)/app/w/[wid]/{workspace-tabs.tsx,courses/{page,loading}.tsx,courses/[cid]/{page,loading,layout}.tsx}  src/components/courses/{courses-panel,create-course-dialog,course-header,course-settings-form,version-conflict-dialog}.tsx (+ tests)   (T11)
apps/web/src/lib/upload/{s3-multipart,tus,engine,resume-store}.ts (+ tests)  src/components/courses/{structure-panel,module-dialog,lesson-dialog,media-picker,upload-dialog,media-state-chip,sortable-list}.tsx (+ tests)   (T12)
apps/web/src/components/rich-text/{editor,renderer,media-image-node,toolbar}.tsx (+ tests)                                 (T13)
apps/web/src/components/courses/{enrollments-panel,assign-students-dialog}.tsx  src/components/{student-profile-panel,students-panel}.tsx (SP2, courses card/column)   (T14)
apps/web/src/app/[locale]/(app)/app/courses/{page,loading}.tsx  courses/[cid]/{page,loading}.tsx  courses/[cid]/lessons/[lid]/{page,loading}.tsx  src/components/learn/{my-courses,course-outline,lesson-shell,lesson-text,complete-button,lesson-state}.tsx (+ tests)  src/app/[locale]/(app)/app/w/[wid]/courses/[cid]/preview/page.tsx   (T15)
apps/web/src/components/learn/{video-player,pdf-viewer,watermark,playback-session}.tsx (+ tests)  src/lib/security-headers.ts  src/proxy.ts  next.config.ts  turbo.json  .github/workflows/ci.yml  .env.example   (T16)
apps/web/e2e/{courses,uploads,learn,watermark}.spec.ts  e2e/a11y.spec.ts  e2e/helpers/{seed,media}.ts  e2e/fixtures/{sample.pdf,sample.mp4,sample.png,not-a-pdf.bin}  packages/db/prisma/seed.ts   (T17)
docs/runbooks/courses-and-media.md  docs/runbooks/{auth-and-tenancy,local-dev,staging,frontend,students-and-invitations}.md  docs/superpowers/specs/2026-10-19-sp3-courses-media-design.md   (T18)
```

---

### Task 0: Contracts — error codes, constants, zod schemas, rich-text schema, job constants

No dependency. Everything later imports from here.

**Files:**

- Create: `packages/contracts/src/course-constants.ts` (+ `.test.ts`), `src/media-constants.ts` (+ `.test.ts`), `src/rich-text.ts` (+ `.test.ts`), `src/courses.ts`, `src/structure.ts`, `src/media.ts`, `src/enrollments.ts`, `src/learn.ts`, `src/courses.test.ts`, `src/structure.test.ts`, `src/media.test.ts`
- Modify: `src/error-codes.ts` (append the 19 codes of spec §7, in that order, under `// SP3: courses, content & media`), `src/queues.ts` (job constants, job ids, scheduler ids, `HOURLY_SCHEDULER_PATTERN`, job payload types), `src/index.ts` (export the eight modules), `src/web.ts` (export `course-constants` and `media-constants` only — zod-free)

**Interfaces:**

- `course-constants.ts` (zod-free): `COURSE_STATUSES`, `COURSE_LEVELS`, `LESSON_TYPES` (all seven), `MVP_LESSON_TYPES`, `UNLOCK_RULE_TYPES`, `MVP_UNLOCK_RULES`, `ENROLLMENT_STATUSES`, `LESSON_PROGRESS_STATUSES`, `ENROLL_BATCH_MAX`, `COURSE_PURGE_AFTER_DAYS`, `MEDIA_STATUS_POLL_MS`, `WATERMARK_MOVE_MS`, `WATERMARK_POSITIONS = 6`, `courseProgressPercent(completedRequired: number, totalRequired: number): number` (`floor(100 × a / b)`, `0` when `b = 0`, clamped 0–100), `parseIfMatch(header: string | undefined): number | null` (`"7"` or `7` → 7; weak `W/"7"` → 7; anything else → `null`), `etagOf(version: number): string` (`"7"`), link builders `courseEditorLink(origin, locale, wid, cid)`, `lessonLink(origin, locale, cid, lid)`, `myCoursesLink(origin, locale)`.
- `media-constants.ts` (zod-free): `MEDIA_KINDS`, `MEDIA_STATUSES`, `MEDIA_PROVIDERS`, `MEDIA_LIMITS`, `MEDIA_MIME_TYPES: Record<MediaKind, readonly string[]>` (VIDEO = Cloudflare's wider list; the S3 provider narrows with `S3_VIDEO_MIME_TYPES`), `UPLOAD_PART_SIZE_BYTES`, `UPLOAD_URL_TTL_S`, `UPLOAD_PARTS_PER_BATCH`, `PLAYBACK_TTL_S`, `INLINE_URL_TTL_S`, `PLAYBACK_TOKENS_PER_HOUR`, `UPLOAD_ABANDON_AFTER_MS`, `PROCESSING_TIMEOUT_MS`, `WEBHOOK_TOLERANCE_S`, `MEDIA_FAILURE_REASONS = ['ABANDONED','TIMEOUT','PROVIDER_ERROR','INVALID_SIGNATURE','ENCRYPTED','QUOTA_EXCEEDED','SIZE_MISMATCH']`, `UPLOAD_MODES = ['S3_MULTIPART','TUS']`, `kindForMime(mime): MediaKind | null`, `partCount(sizeBytes, partSize)`, `sanitizeFilename(name): string` (NFKD → ASCII, `[^A-Za-z0-9._-]` → `_`, ≤ 120 chars, never empty, keeps the extension), `formatBytes` stays in the web.
- `rich-text.ts` (zod): `RICH_TEXT_MAX_BYTES`, `RICH_TEXT_MAX_DEPTH`, `RichTextDocSchema` (recursive `z.lazy`; node union exactly as spec §5; `text` nodes need non-empty `text` and optional `marks`; `link` mark `attrs.href` refined to `^https?://` ≤ 2048; `image` `attrs: { mediaId: z.uuid(), alt: z.string().max(200).optional() }`; `heading.attrs.level` 1–3; `.strict()` everywhere) + `superRefine` for depth and `JSON.stringify(doc).length ≤ RICH_TEXT_MAX_BYTES`; `RichTextDescriptionSchema` (same, `image` excluded); `collectImageIds(doc): string[]`; `richTextPlainText(doc, max = 200): string` (for list excerpts); `EMPTY_DOC`.
- `courses.ts`: `CreateCourseSchema` `{ title (trim 1–200), description?: RichTextDescriptionSchema, category?: trim ≤ 60, level?: enum(COURSE_LEVELS), language: LocaleSchema (default 'fr'), estimatedMinutes?: int 0–100000 | null, sequentialLessons?: boolean, coverMediaId?: uuid | null }.strict()`; `UpdateCourseSchema` = all optional (at least one key); `CoursesQuerySchema` `{ status?, q? (trim 1–100), cursor?: uuid, limit 1–100 default 50 }`; `CourseSummarySchema` `{ id, title, status, level, language, category, coverUrl (nullable), ownerUserId, owner: { firstName, lastName }, estimatedMinutes (derived or override), moduleCount, lessonCount, enrolledCount, publishedAt, archivedAt, version, createdAt, updatedAt }`; `CoursesPageSchema`; `CourseDetailSchema` = summary + `{ description, sequentialLessons, isCertifying, deletedAt: null, canPublish: boolean, publishBlockers: enum(['NO_MODULE','NO_READY_LESSON'])[] }`; `ReassignCourseSchema` `{ ownerUserId: uuid }.strict()`; `PublishResultSchema` = `CourseDetailSchema`.
- `structure.ts`: `UnlockRuleSchema = z.discriminatedUnion('type', [{ type: 'NONE' }, { type: 'PREVIOUS_MODULE_COMPLETED' }])` (P1 types refused by the enum); `CreateModuleSchema` `{ title, description?, isOptional?, unlockRule? (default NONE) }.strict()`; `UpdateModuleSchema`; `ReorderSchema` `{ ids: z.array(z.uuid()).min(1).max(500) }` (used for both `moduleIds`/`lessonIds` under the key `ids`); `CreateLessonSchema = z.discriminatedUnion('type', [ VIDEO { title, description?, isRequired?, estimatedMinutes?, mediaAssetId: uuid }, PDF { …, mediaAssetId, allowDownload?: boolean }, TEXT { …, content: RichTextDocSchema } ])` (every variant `.strict()`); `UpdateLessonSchema` (type immutable: `{ title?, description?, isRequired?, estimatedMinutes?, mediaAssetId?, allowDownload?, content? }` — the service refuses a field foreign to the lesson's type with `422`); `LessonMediaSchema` `{ id, kind, status, failureReason, durationS, pageCount, width, height, thumbnailUrl (nullable) }`; `LessonSummarySchema` `{ id, moduleId, title, description, type, position, isRequired, estimatedMinutes, allowDownload, mediaAssetId, media: LessonMedia | null, hasContent: boolean, version }`; `ModuleWithLessonsSchema` `{ id, title, description, position, isOptional, unlockRule, version, lessons: LessonSummary[] }`; `CourseStructureSchema` `{ courseId, version, status, sequentialLessons, modules: ModuleWithLessons[] }`; `LessonDetailSchema` = `LessonSummary & { content: RichTextDoc | null, images: Record<string, string> }` (teacher-side GET of one lesson).
- `media.ts`: `CreateUploadSchema` `{ kind: enum(MEDIA_KINDS without RECORDING), filename: trim 1–255, mimeType: string, sizeBytes: int ≥ 1 }.strict()` + refine `sizeBytes ≤ MEDIA_LIMITS[kind].maxBytes` (issue `PAYLOAD_TOO_LARGE`-style message) and `mimeType ∈ MEDIA_MIME_TYPES[kind]`; `UploadTicketSchema = z.discriminatedUnion('mode', [ { mode: 'S3_MULTIPART', mediaId, partSizeBytes, partCount, parts: [{ partNumber, url }], expiresAt }, { mode: 'TUS', mediaId, uploadUrl, expiresAt } ])`; `UploadStateSchema` `{ mediaId, mode: 'S3_MULTIPART', partSizeBytes, partCount, uploaded: [{ partNumber, etag, size }], parts: [{ partNumber, url }] (missing ones), expiresAt }`; `CompleteUploadSchema` `{ parts: z.array({ partNumber: int ≥ 1, etag: string 1–200 }).max(10000).optional() }.strict()`; `MediaAssetSchema` `{ id, kind, provider, status, failureReason, originalFilename, mimeType, sizeBytes (string), durationS, width, height, pageCount, thumbnailUrl, ownerUserId, uploadUrlExpiresAt, readyAt, createdAt, updatedAt, usedBy: [{ lessonId, lessonTitle, courseId, courseTitle, courseStatus }] }`; `MediaQuerySchema` `{ kind?, status?, cursor?, limit }`; `MediaPageSchema`; `PlaybackSchema = z.discriminatedUnion('kind', [ { kind: 'HLS', url, expiresAt }, { kind: 'MP4', url, expiresAt }, { kind: 'PDF', url, expiresAt, allowDownload } ])`; `DownloadSchema` `{ url, expiresAt, filename }`; `WorkspaceStorageSchema` (extends SP1's `{ quotaBytes, usedBytes }` with `reservedBytes`) — additive change in `workspaces.ts`.
- `enrollments.ts`: `EnrollStudentsSchema` `{ studentUserIds: z.array(z.uuid()).min(1).max(ENROLL_BATCH_MAX) }.strict()`; `EnrollResultSchema` `{ items: [{ studentUserId, status: 'ACTIVE', created: boolean }] }`; `RevokeEnrollmentSchema` `{ reason?: trim ≤ 500 }.strict()`; `EnrollmentSummarySchema` `{ studentUserId, firstName, lastName, status, source, activatedAt, revokedAt, progressPercent, completedAt, lastActivityAt }`; `EnrollmentsQuerySchema` `{ status?, cursor?: uuid, limit }`; `EnrollmentsPageSchema`; `StudentCourseSchema` `{ courseId, title, status, enrollmentStatus, progressPercent, completedAt }` (what SP2's `StudentSummary.courses` / `StudentProfile.courses` now hold — `students.ts` is updated to `z.array(StudentCourseSchema)` and `progressPercent: z.number().nullable()` keeps its type).
- `learn.ts`: `MyCourseSchema` `{ course: { id, title, coverUrl, level, language, estimatedMinutes, status, workspace: { id, name }, teacher: { firstName, lastName } }, progressPercent, completedAt, lastActivityAt }`; `MyCoursesSchema` `{ items }`; `LockSchema = z.discriminatedUnion('reason', [{ reason: 'PREVIOUS_MODULE_INCOMPLETE', previousModule: { id, title, percent } }, { reason: 'PREVIOUS_LESSON_INCOMPLETE', previousLesson: { id, title } }])`; `MyLessonSchema` `{ id, title, description, type, position, isRequired, estimatedMinutes, allowDownload, media: { status, durationS, pageCount } | null, progress: { status, completedAt }, locked: boolean, lock: Lock | null }`; `MyModuleSchema` `{ id, title, description, position, isOptional, unlockRule, percent, locked, lock, lessons }`; `MyCourseDetailSchema` `{ course (as MyCourse.course + description, sequentialLessons), progressPercent, completedAt, modules, next: { lessonId } | null }`; `MyLessonDetailSchema` `{ lesson: MyLesson, course: { id, title }, module: { id, title }, content: RichTextDoc | null, images: Record<string,string>, playback: Playback | null, previous: { lessonId } | null, next: { lessonId } | null }`; `ProgressActionResultSchema` `{ lesson: { id, status, completedAt }, course: { progressPercent, completedAt } }`.
- `queues.ts`: the job constants, id builders and scheduler ids of Global Constraints; payload types `MediaProcessJob { mediaId; workspaceId }`, `MediaWebhookProcessJob { webhookEventId }`, `MediaDeleteJob { mediaId; workspaceId }`, `CourseAssignedNotifyJob { workspaceId; enrollmentIds: string[] }`, `CoursePublishedNotifyJob { workspaceId; courseId }`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/contracts/src/course-constants.test.ts
it("courseProgressPercent floors and clamps", () => {
  expect(courseProgressPercent(7, 10)).toBe(70);
  expect(courseProgressPercent(0, 0)).toBe(0);
  expect(courseProgressPercent(2, 3)).toBe(66);
  expect(courseProgressPercent(5, 3)).toBe(100);
});
it('parseIfMatch accepts "7", 7 and W/"7", refuses the rest', () => {
  expect(parseIfMatch('"7"')).toBe(7);
  expect(parseIfMatch("7")).toBe(7);
  expect(parseIfMatch('W/"7"')).toBe(7);
  expect(parseIfMatch("*")).toBeNull();
  expect(parseIfMatch(undefined)).toBeNull();
  expect(parseIfMatch('"7", "8"')).toBeNull();
});
// media-constants.test.ts: kindForMime('application/pdf') === 'PDF', 'video/mp4' → 'VIDEO', 'text/html' → null; partCount(8 MiB + 1, 8 MiB) === 2; sanitizeFilename('Cours n°1 (été).PDF') === 'Cours_n_1_ete_.PDF', sanitizeFilename('…') is non-empty and ≤ 120
// rich-text.test.ts: a doc with heading/paragraph/bold/link https → ok; link javascript: → issue at marks[0].attrs.href; unknown node 'iframe' → issue; image with mediaId ok in RichTextDocSchema, refused in RichTextDescriptionSchema; depth 21 → issue; collectImageIds returns ids in document order, deduplicated; richTextPlainText truncates at max with '…'
// courses.test.ts: CreateCourseSchema defaults language 'fr', refuses unknown key; UpdateCourseSchema refuses {}; CoursesQuerySchema coerces limit
// structure.test.ts: CreateLessonSchema VIDEO needs mediaAssetId, TEXT needs content, PDF accepts allowDownload, VIDEO refuses content; UnlockRuleSchema refuses { type: 'AFTER_DATE', date }; ReorderSchema refuses duplicates (refine)
// media.test.ts: CreateUploadSchema refuses VIDEO over 4 GiB, PDF with image/png, RECORDING kind; UploadTicketSchema parses both modes
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/contracts exec vitest run src/course-constants src/media-constants src/rich-text src/courses src/structure src/media` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the files above; `pnpm turbo run build --filter=@nibras/contracts --concurrency=2`.
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/contracts --concurrency=2` — Expected: PASS; `web.test.ts` (zod-free entry) still passes with the two new constant modules.
- [ ] **Step 5: Commit**

```bash
git add packages/contracts && git commit -m "feat(contracts): sp3 courses, structure, media, enrollment and learn schemas; rich-text whitelist; error codes and media jobs"
```

---

### Task 1: Database — seven models, deferrable positions, lesson content check, RLS, lookup keys

Depends on T0 (enum names). Includes the migration.

**Files:**

- Create: `packages/db/prisma/migrations/<ts>_courses_media/migration.sql`
- Modify: `packages/db/prisma/schema.prisma` (enums `CourseStatus`, `CourseLevel`, `LessonType`, `EnrollmentStatus`, `LessonProgressStatus`, `MediaKind`, `MediaStatus`, `MediaProvider`, `MediaFailureReason` (the seven reasons), `EnrollmentSource`; models of spec §3 with relations: `Course.owner → User`, `Course.workspace`, `Course.cover → MediaAsset?`, `Course.modules`, `Course.enrollments`; `Module.course` (Cascade); `Lesson.module` (Cascade), `Lesson.mediaAsset → MediaAsset?` (`onDelete: Restrict`), `Lesson.progress`; `MediaAsset.owner → User`, `MediaAsset.workspace`; `Enrollment.course`, `Enrollment.student → User`; `LessonProgress.lesson`, `LessonProgress.student → User`; `WebhookEvent`; `User.avatar → MediaAsset?` and `Workspace.logo → MediaAsset?` (`onDelete: SetNull`) with their relation names), `packages/db/src/tenancy.ts` (`TENANT_MODELS` += `'Course', 'Module', 'Lesson', 'MediaAsset', 'Enrollment', 'LessonProgress'`), `packages/db/src/tenant.ts` (`CROSS_TENANT_LOOKUP_KEYS` += `Enrollment: ['studentUserId'], LessonProgress: ['studentUserId']`), `packages/db/src/schema.test.ts`, `packages/db/src/tenant.test.ts`
- Test: `packages/db/src/schema.test.ts`, `packages/db/src/tenant.test.ts`

**Interfaces:**

- Migration: Prisma's generated statements, then the hand-written section (same comment style): (1) RLS `ENABLE` + `FORCE` + `tenant_isolation` policy for the six 🏢 tables; (2) `DROP INDEX "module_course_position_key"; ALTER TABLE "module" ADD CONSTRAINT "module_course_position_key" UNIQUE ("course_id", "position") DEFERRABLE INITIALLY IMMEDIATE;` and the same for `lesson_module_position_key` (spec D9 — if `migrate:check` reports a diff for the constraint, fall back to keeping Prisma's unique indexes and record in the commit body that T6 must renumber in two phases: `position = -position` for the set, then the final values); (3) `ALTER TABLE "lesson" ADD CONSTRAINT "lesson_content_by_type_check" CHECK (…)` as spec §3; (4) `CREATE UNIQUE INDEX "media_asset_provider_asset_key" ON "media_asset"("provider", "provider_asset_id") WHERE "provider_asset_id" IS NOT NULL;` (5) `ALTER TABLE "lesson_progress" ALTER COLUMN "watched_segments" SET DEFAULT '[]'::jsonb;` if Prisma's default needs it; (6) `CHECK ("progress_percent" BETWEEN 0 AND 100)` on `enrollment`.
- `schema.test.ts` (via `systemPrisma()`): the deferred constraint lets two modules swap positions inside one transaction with `SET CONSTRAINTS ALL DEFERRED` and refuses the swap without it; `lesson_content_by_type_check` refuses a VIDEO lesson without `media_asset_id` and a TEXT lesson with one; the partial unique index refuses two assets with the same `(provider, provider_asset_id)` and allows two `NULL`s; RLS: with `app.workspace_id` set to A, `SELECT` on `course` returns A's rows only (raw SQL through the `app_user` client, same shape as the existing membership RLS test); `progress_percent = 101` refused.
- `tenant.test.ts`: `crossTenantDb().enrollment.findMany({ where: { studentUserId } })` passes the filter rule, `{ where: { courseId } }` throws `CrossTenantFilterMissingError`.

- [ ] **Step 1: Write the failing tests** (the cases above, in the files' existing style).
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/db exec vitest run src/schema.test.ts src/tenant.test.ts` — Expected: FAIL (models missing).
- [ ] **Step 3: Implement** — schema, `pnpm --filter @nibras/db migrate:dev -- --name courses_media --create-only`, append the SQL, `pnpm db:migrate && pnpm db:migrate:test && pnpm --filter @nibras/db migrate:check`, tenancy lists, `pnpm turbo run build --filter=@nibras/db --concurrency=2`.
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/db --concurrency=2 && pnpm --filter @nibras/db migrate:check` — Expected: PASS. The API's existing isolation suite must still boot (`pnpm --filter @nibras/api exec vitest run test/isolation` — no new routes yet, so green).
- [ ] **Step 5: Commit**

```bash
git add packages/db && git commit -m "feat(db): course, module, lesson, media_asset, enrollment, lesson_progress and webhook_event; deferrable positions, content check, RLS, cross-tenant lookup by student"
```

---

### Task 2: StorageProvider — S3 (MinIO/OVH), in-memory fake, test buckets, MinIO in CI

Depends on T0 (`media-constants`). The first task that needs MinIO.

**Files:**

- Create: `packages/providers/src/storage/types.ts`, `src/storage/s3.ts` (+ `s3.test.ts`), `src/storage/in-memory.ts` (+ `in-memory.test.ts`), `src/storage/keys.ts` (+ `keys.test.ts`), `packages/providers/test-setup.ts`
- Modify: `packages/providers/package.json` (deps `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` exact), `packages/providers/src/index.ts`, `packages/providers/vitest.config.ts` (setup file loading the root `.env` + `applyTestEnv('providers', process.env)`), `packages/config/vitest/test-env.mjs` (+ `.d.mts`, `.test.ts`: `TEST_PACKAGES` += `'providers'`; `testBucketName(pkg) = 'nibras-<pkg>-test'`; `applyTestEnv` sets `S3_BUCKET_TEST` from the base `S3_BUCKET_TEST` when present — `nibras-test` → `nibras-api-test`; providers get Redis/DB offsets too, unused), `packages/contracts/src/env-placeholders.ts` (+ test: `PLACEHOLDER_SECRETS` += `minioadmin`; `assertDeployableEnv` gains optional `S3_SECRET_KEY`, `CLOUDFLARE_STREAM_API_TOKEN`, `CLOUDFLARE_STREAM_WEBHOOK_SECRET`, `CLOUDFLARE_STREAM_SIGNING_KEY_PEM` checks through `isPlaceholderSecret`), `turbo.json` (`test.env` += the `S3_*` list), `.github/workflows/ci.yml` (`check` job: env `S3_ENDPOINT=http://localhost:9000`, `S3_PUBLIC_ENDPOINT` unset, `S3_REGION=us-east-1`, `S3_ACCESS_KEY=minioadmin`, `S3_SECRET_KEY=minioadmin`, `S3_BUCKET=nibras-dev`, `S3_BUCKET_TEST=nibras-test`, `S3_FORCE_PATH_STYLE=true`, `VIDEO_PROVIDER=s3`; a step "Start MinIO" before `pnpm test`: `docker run -d --name minio -p 9000:9000 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin pgsty/minio:RELEASE.2026-08-04T00-00-00Z@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372 server /data` then a bash wait loop on `curl -sf http://localhost:9000/minio/health/live` (≤ 60 s); the same step in the `e2e` job), `.env.example` (`S3_REGION=us-east-1`, `S3_PUBLIC_ENDPOINT=` (empty = `S3_ENDPOINT`), `S3_BUCKET_TEST=nibras-test`, `S3_FORCE_PATH_STYLE=true`, `VIDEO_PROVIDER=s3`, commented `CLOUDFLARE_*` block, with a comment that `minioadmin` is refused outside development)
- Test: the three provider tests, `packages/config/vitest/test-env.test.ts`, `packages/contracts/src/env-placeholders.test.ts`

**Interfaces:**

- `types.ts`: `StorageProvider` exactly as spec §6 (`Part = { partNumber: number; etag: string; size: number }`, `SignGetOptions = { disposition: 'inline' | 'attachment'; filename?: string; contentType?: string }`), `StorageObjectMissingError`.
- `keys.ts`: `storageKeyFor({ workspaceId, kind, mediaId, filename })` → `w/{wid}/{kind-lowercase}/{mediaId}/{sanitizeFilename(filename)}`; `isStorageKeyOf(key, workspaceId)`.
- `s3.ts`: `S3StorageProvider({ endpoint, publicEndpoint?, region, accessKeyId, secretAccessKey, bucket, forcePathStyle })`: two `S3Client`s when `publicEndpoint` differs (operations vs presigning); `createMultipartUpload` (`ContentType`), `signPartUrl` (`UploadPartCommand` presigned `expiresIn = ttlS`), `listParts` (paginates `ListPartsCommand`), `completeMultipart` (parts sorted by number), `abortMultipart`, `head` (`NotFound` → `null`), `getRange` (`Range: bytes=start-end`, returns `Uint8Array`), `signGetUrl` (`ResponseContentDisposition` built with RFC 5987 `filename*=UTF-8''…` when `filename`), `delete` (idempotent), plus `ensureBucket()` and `emptyBucket()` (test/ops helpers: `CreateBucket` tolerant of `BucketAlreadyOwnedByYou`; list + `DeleteObjects` in pages of 1000, abort every multipart upload). `createS3StorageProviderFromEnv(env)` reads the `S3_*` names.
- `in-memory.ts`: `InMemoryStorageProvider` with the same contract (parts kept per uploadId; `signGetUrl` → `https://storage.test/{key}?disposition=…&exp=…`; `signPartUrl` → `https://storage.test/upload/{uploadId}/{partNumber}`), `objects` map exposed for assertions.
- `test-setup.ts` (providers): loads `../../.env` with `dotenv` only when present, `applyTestEnv('providers', process.env)`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/providers/src/storage/s3.test.ts  (describe.skipIf(!process.env.S3_ENDPOINT))
beforeAll(async () => { s3 = createS3StorageProviderFromEnv({ ...process.env, S3_BUCKET: process.env.S3_BUCKET_TEST! }); await s3.ensureBucket(); await s3.emptyBucket(); });
it('multipart: parts uploaded through presigned URLs are listed, completed and readable by range', async () => {
  const key = storageKeyFor({ workspaceId: wid, kind: 'PDF', mediaId: id, filename: 'a.pdf' });
  const { uploadId } = await s3.createMultipartUpload(key, 'application/pdf');
  const part1 = Buffer.alloc(5 * 1024 * 1024, 1), part2 = Buffer.from('%PDF-tail');
  for (const [n, body] of [[1, part1], [2, part2]] as const) {
    const res = await fetch(await s3.signPartUrl(key, uploadId, n, 60), { method: 'PUT', body });
    expect(res.status).toBe(200); etags.push({ partNumber: n, etag: res.headers.get('etag')!, size: body.length });
  }
  expect((await s3.listParts(key, uploadId)).map((p) => p.partNumber)).toEqual([1, 2]);
  await s3.completeMultipart(key, uploadId, etags);
  expect((await s3.head(key))?.sizeBytes).toBe(part1.length + part2.length);
  expect(Buffer.from(await s3.getRange(key, part1.length, part1.length + 8)).toString()).toBe('%PDF-tai');
});
it('signGetUrl inline/attachment sets Content-Disposition; an expired URL is refused', …); // ttlS 1 → wait 2 s → 403
it('abortMultipart drops the parts; delete is idempotent; head of a missing key is null', …);
// in-memory.test.ts: same contract on the fake (minus HTTP)
// keys.test.ts: storageKeyFor shape, isStorageKeyOf rejects another workspace
// packages/config/vitest/test-env.test.ts: testBucketName('api') === 'nibras-api-test'; applyTestEnv rewrites S3_BUCKET_TEST
// packages/contracts/src/env-placeholders.test.ts: S3_SECRET_KEY=minioadmin refused on staging, accepted in development
```

- [ ] **Step 2: Run to verify failure** — `docker compose up -d && pnpm --filter @nibras/providers exec vitest run src/storage` — Expected: FAIL.
- [ ] **Step 3: Implement** — `pnpm --filter @nibras/providers add @aws-sdk/client-s3@3.1152.0 @aws-sdk/s3-request-presigner@3.1152.0`; the files; turbo/ci/.env.example; `pnpm turbo run build --filter=@nibras/contracts --filter=@nibras/providers --concurrency=2`.
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/config --filter=@nibras/contracts --filter=@nibras/providers --concurrency=2 && pnpm audit --prod --audit-level=high` — Expected: PASS; with `S3_ENDPOINT` unset the S3 suite reports skipped (the windows-check path).
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(providers,config,ci): S3 StorageProvider (MinIO/OVH), in-memory fake, per-package test buckets, MinIO in CI, placeholder refusal for S3 and Cloudflare secrets"
```

---

### Task 3: VideoProvider — S3 passthrough (MP4 probe), Cloudflare Stream adapter, fake

Depends on T2.

**Files:**

- Create: `packages/providers/src/video/types.ts`, `src/video/mp4-probe.ts` (+ `mp4-probe.test.ts`, `fixtures/mp4-fixture.ts` — builds a minimal MP4 in memory: `ftyp`, then either `moov` before or after a `mdat` of N bytes; `mvhd` v0 with `timescale = 1000`, `duration = 12_345`; one `trak/tkhd` with width/height as 16.16 fixed; a 64-bit `mvhd` v1 variant), `src/video/s3-video.ts` (+ `.test.ts`), `src/video/cloudflare-stream.ts` (+ `.test.ts`, `fixtures/cloudflare/{direct-upload.json,asset-ready.json,asset-error.json,webhook-ready.json}`), `src/video/fake.ts`
- Modify: `packages/providers/src/index.ts`, `packages/providers/package.json` (no new dep: `jose` is injected by the API — see below; the adapter takes a `signJwt` function to stay dependency-free)
- Test: the three tests

**Interfaces:**

- `types.ts`: `VideoProvider`, `VideoAssetRef = { providerAssetId?: string; storageKey?: string }`, `DirectUpload` union, `VideoAssetInfo`, `PlaybackGrant`, `VideoWebhookEvent = { providerAssetId; state: 'READY' | 'FAILED' | 'PROCESSING'; durationS?; width?; height?; thumbnailUrl?; sizeBytes?; failureReason? }`, `WebhookVerification` as spec §6.
- `mp4-probe.ts`: `probeMp4(read: (start, end) => Promise<Uint8Array>, fileSize): Promise<{ durationS: number | null; width: number | null; height: number | null; brand: string | null }>`: reads 8/16-byte box headers, follows `size` (64-bit `largesize` when `size = 1`, to-end when `0`), stops after `moov`; `moov` is read fully once found (bounded to 8 MiB, else `durationS: null`); no `ftyp` → throws `NotMp4Error`. `probeWebm` is **not** written: WebM → nulls (owner Q6).
- `s3-video.ts`: `S3VideoProvider(storage: StorageProvider, { playbackTtlS })` as spec §6; `acceptedMimeTypes = S3_VIDEO_MIME_TYPES`; `getAsset` → `head` (missing → `FAILED 'PROVIDER_ERROR'`), probe when `video/mp4`, `READY` with the numbers (`sizeBytes` from `head`), `durationS > maxDurationS` is the caller's rule (T8).
- `cloudflare-stream.ts`: `CloudflareStreamProvider({ accountId, apiToken, webhookSecret, signingKeyId, signingKeyPem, customerSubdomain, fetch = globalThis.fetch, signJwt: (payload, kid, pem) => Promise<string>, now = () => new Date() })` as spec §6; `acceptedMimeTypes = MEDIA_MIME_TYPES.VIDEO`; errors → `VideoProviderError(status, body)`; `verifyWebhook` constant-time (`timingSafeEqual`), `eventId = sha256(rawBody)`, parses `{ uid, readyToStream, status: { state, errorReasonCode }, duration, input: { width, height }, thumbnail, size, meta }`.
- `fake.ts`: `FakeVideoProvider` (`uploads: DirectUpload[]`, `assets: Map<id, VideoAssetInfo>`, `deleted: string[]`, `nextWebhook(events)`), used by API/worker tests that force the TUS path.

- [ ] **Step 1: Write the failing tests**

```ts
// mp4-probe.test.ts
it('reads duration and dimensions from a faststart file and from a moov-at-end file', async () => {
  for (const moovFirst of [true, false]) {
    const buf = buildMp4({ moovFirst, timescale: 1000, duration: 12_345, width: 1280, height: 720, mdatBytes: 100_000 });
    const probe = await probeMp4((s, e) => Promise.resolve(buf.subarray(s, e + 1)), buf.length);
    expect(probe).toEqual({ durationS: 12, width: 1280, height: 720, brand: 'isom' });
  }
});
it('handles mvhd version 1 and refuses a non-mp4', …);
// s3-video.test.ts (InMemoryStorageProvider): createDirectUpload returns S3_MULTIPART with a key under the workspace; getAsset of a stored fixture → READY 12 s; signPlayback → kind MP4, expiresAt ≈ now + ttl; verifyWebhook → { ok: false, reason: 'NO_WEBHOOKS' }
// cloudflare-stream.test.ts (fetch stub records requests):
it('createDirectUpload posts a tus creation and returns Location + stream-media-id', …); // headers Tus-Resumable 1.0.0, Upload-Length, Upload-Metadata contains maxDurationSeconds and requiresignedurls
it('signPlayback builds https://{sub}/{jwt}/manifest/video.m3u8 with kid, sub and exp = now + ttl', …); // signJwt stub returns 'JWT'; decoded payload asserted
it('verifyWebhook: valid signature → ok with eventId = sha256(body); stale time → INVALID_TIME; wrong sig → INVALID_SIGNATURE; missing header → MISSING_SIGNATURE', …); // secret 'test-secret', fixed time
it('getAsset maps readyToStream / error states', …);
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/providers exec vitest run src/video` — Expected: FAIL.
- [ ] **Step 3: Implement**, `pnpm turbo run build --filter=@nibras/providers --concurrency=2`.
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/providers --concurrency=2` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/providers && git commit -m "feat(providers): VideoProvider with S3 passthrough (MP4 probe, presigned playback) and Cloudflare Stream adapter (tus upload, signed manifest, verified webhooks)"
```

---

### Task 4: API and worker wiring — env, provider tokens, raw body, S3 init script, staging allocation

Depends on T3.

**Files:**

- Create: `apps/api/scripts/s3-init.mjs` (`ensureBucket` on `S3_BUCKET` and, with `--test`, `S3_BUCKET_TEST`; tries `PutBucketCors` for `WEB_ORIGIN` (methods GET/PUT/HEAD, exposed `ETag`), ignores `NotImplemented` (MinIO allows CORS by default)), `apps/api/src/media/tokens.ts` (`STORAGE_PROVIDER`, `VIDEO_PROVIDER_TOKEN` symbols; `createStorageProvider(env)`, `createVideoProvider(env, storage)` — Cloudflare's `signJwt` built on `jose` `SignJWT` + `importPKCS8`)
- Modify: `apps/api/src/config/env.ts` (+ `env.spec.ts`: `S3_ENDPOINT: z.url()`, `S3_PUBLIC_ENDPOINT: optionalUrl`, `S3_REGION: z.string().default('us-east-1')`, `S3_ACCESS_KEY`, `S3_SECRET_KEY: z.string().min(1)`, `S3_BUCKET: z.string().regex(/^[a-z0-9.-]{3,63}$/)`, `S3_FORCE_PATH_STYLE: z.stringbool().default(true)`, `VIDEO_PROVIDER: z.enum(['s3','cloudflare_stream']).default('s3')`, `CLOUDFLARE_*` optional strings, `superRefine`: `VIDEO_PROVIDER=cloudflare_stream` requires every `CLOUDFLARE_*` (issue per missing one), `assertDeployableEnv` gets the new secrets), `apps/api/src/providers/providers.module.ts` (provide/export the two tokens), `apps/api/src/main.ts` (`NestFactory.create(…, { bufferLogs: true, rawBody: true })`), `apps/api/test/helpers/app.ts` (`createNestApplication({ logger: false, rawBody: true })`; after `app.listen`, `await storage.ensureBucket()` once per process on `S3_BUCKET_TEST`; `reset()` also `emptyBucket()`; expose `storage` and `video` from `app.get(...)`), `apps/api/test/setup.ts` (`process.env.S3_BUCKET = process.env.S3_BUCKET_TEST` after `applyTestEnv`, like the DB URL swap), `apps/api/package.json` (`"s3:init": "dotenv -e ../../.env -- node scripts/s3-init.mjs"`), `apps/worker/src/env.ts` (+ `env.test.ts`: same `S3_*`, `VIDEO_PROVIDER`, `CLOUDFLARE_*` subset: account, token, signing key not needed → only `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_API_TOKEN` for `getAsset`/`delete`), `apps/worker/src/providers.ts` (`createStorageProvider`, `createVideoProvider`; the worker's Cloudflare instance gets a `signJwt` that throws — it never signs), `apps/worker/src/worker.module.ts` (provide/export `STORAGE_PROVIDER`, `VIDEO_PROVIDER_TOKEN`), `apps/worker/test/*.e2e-spec.ts` env fixtures (add the S3 values to `loadEnv` inputs), `infra/compose.staging.yml` (`api` and `worker`: `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `VIDEO_PROVIDER`, `CLOUDFLARE_*` (`${VAR:-}` for the optional ones); `web`: `MEDIA_ORIGINS` (T16 reads it); `minio` unchanged), `packages/config/infra/compose-staging.test.ts` (the `api` assertion becomes: no `DATABASE_URL_SYSTEM`, no `POSTGRES_PASSWORD`; `S3_*` allowed on `api` and `worker`; `web` still matches no secret pattern — `MEDIA_ORIGINS` passes), `docs/runbooks/staging.md` (`.env.staging` block: the S3 public endpoint and the CORS rule; `VIDEO_PROVIDER` and the Cloudflare block; `pnpm --filter @nibras/api s3:init` after the first boot), `docs/runbooks/local-dev.md` (first run: `pnpm --filter @nibras/api s3:init -- --test`; the test suites need MinIO)
- Test: `apps/api/src/config/env.spec.ts`, `apps/worker/src/env.test.ts`, `packages/config/infra/compose-staging.test.ts`, existing API/worker suites (boot with the new env)

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/config/env.spec.ts (+)
it('S3_* are required; VIDEO_PROVIDER defaults to s3; cloudflare_stream needs every CLOUDFLARE_* variable', () => {
  expect(EnvSchema.parse(valid).VIDEO_PROVIDER).toBe('s3');
  expect(() => EnvSchema.parse({ ...valid, S3_BUCKET: undefined })).toThrow(/S3_BUCKET/);
  expect(() => EnvSchema.parse({ ...valid, VIDEO_PROVIDER: 'cloudflare_stream' })).toThrow(/CLOUDFLARE_ACCOUNT_ID/);
});
it('staging refuses S3_SECRET_KEY=minioadmin and a placeholder CLOUDFLARE_STREAM_WEBHOOK_SECRET', …);
// apps/worker/src/env.test.ts: same subset
// compose-staging.test.ts: api and worker carry S3_ENDPOINT/S3_SECRET_KEY/VIDEO_PROVIDER; web carries MEDIA_ORIGINS and nothing matching the secret regex; migrate has no S3_*
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/api exec vitest run src/config/env.spec.ts && pnpm --filter @nibras/worker exec vitest run src/env.test.ts && pnpm --filter @nibras/config exec vitest run infra` — Expected: FAIL.
- [ ] **Step 3: Implement**; run `pnpm --filter @nibras/api s3:init -- --test` locally once.
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/api --filter=@nibras/worker --filter=@nibras/config --concurrency=2 && docker compose -f infra/compose.staging.yml --env-file .env.example config > /dev/null` — Expected: PASS (every existing API/worker spec boots with the new env; the `config` render needs no real values beyond `.env.example`).
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api,worker,infra): S3 and video provider wiring, VIDEO_PROVIDER env with cloudflare_stream secrets, raw body for webhooks, s3:init script, staging allocation"
```

---

### Task 5: API courses — CRUD, If-Match, lifecycle, deletion rules, reassign, isolation fixtures

Depends on T4.

**Files:**

- Create: `apps/api/src/common/if-match.ts` (+ `if-match.spec.ts`), `apps/api/src/courses/{courses.module.ts,courses.controller.ts,courses.service.ts,course-access.ts,dto.ts}`, `apps/api/test/courses/courses.e2e-spec.ts`, `apps/api/test/courses/course-lifecycle.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts` (import `CoursesModule`), `apps/api/src/audit/audit.service.ts` (`course.*` actions), `apps/api/src/workspaces/workspaces.service.ts` (`storage()` adds `reservedBytes`: Σ `sizeBytes` of `UPLOADING` assets), `packages/contracts/src/workspaces.ts` (`WorkspaceStorageSchema.reservedBytes`), `apps/api/test/isolation/fixtures.ts` (`FOREIGN_PARAMS.cid` → a course of B; `FOREIGN_BODIES` for `POST …/courses` `{ coverMediaId: B's image }` (T7 creates media fixtures; until then the body uses a random uuid and the entry is completed in T7), `PATCH …/courses/:cid`, `POST …/courses/:cid/reassign { ownerUserId: B's teacher }`; `BODYLESS_WRITE_ROUTES` += publish/unpublish/archive/restore), `apps/api/test/helpers/factories.ts` (`createCourse(workspace, owner, { status?, title?, sequentialLessons? })`, `createModule(course, { position?, isOptional?, unlockRule? })`, `createLesson(module, { type, mediaAsset?, content?, isRequired?, position? })`, `createMediaAsset(workspace, owner, { kind, status?, storageKey?, sizeBytes? })` — raw rows through `systemPrisma()`), `apps/api/test/helpers/invariants.ts` (`expectStructureInvariant`)
- Test: the two e2e specs, `if-match.spec.ts`, `test/isolation` (green with the fixtures), `test/workspaces` (storage shape)

**Interfaces:**

- `if-match.ts`: `@IfMatch()` param decorator → `ifMatchVersion(req): number` (`parseIfMatch` on the header; `null` → `428 VERSION_REQUIRED`); `assertVersion(current: number, expected: number)` → `409 VERSION_CONFLICT { currentVersion: current }`; `setEtag(res, version)` helper used by the controllers (`@Res({ passthrough: true })`).
- `course-access.ts`: `courseCtx(wid): CourseCtx { workspaceId, userId, role, scope }` (throws `403 PERMISSION_DENIED` for STUDENT/GUARDIAN memberships); `ownerFilter(ctx): Prisma.CourseWhereInput` (`scope === 'own'` → `{ ownerUserId: ctx.userId }`); `loadCourseForWrite(tx, ctx, cid)` → `SELECT … FOR UPDATE` on the course row (`Prisma.sql`), `deletedAt: null`, owner filter, else `404`.
- `CoursesService`: `list(ctx, q)` (keyset `createdAt desc, id desc`; `status` filter; `q` ILIKE on title; `coverUrl` presigned 5 min per row when `coverMediaId` READY), `create(ctx, input)` (defaults from `readSettings(workspace)`; `coverMediaId` must be a READY IMAGE of the workspace, else `422`), `get(ctx, cid)` (+ `canPublish`/`publishBlockers` computed), `update(ctx, cid, input, expectedVersion)` (lock, version check, apply, `version + 1`, audit `course.updated` with changed keys), `publish/unpublish/archive/restore(ctx, cid)` (state machine of spec §4.1; `publish` computes blockers in the tx: at least one lesson with `type = TEXT` or `mediaAsset.status = READY`; on success `publishedAt`, audit, enqueue `COURSE_PUBLISHED_NOTIFY_JOB` with `jobId = coursePublishedNotifyJobId(cid, version)`; `unpublish` audits and emits nothing else), `remove(ctx, cid)` (rules → `deletedAt`; audit `course.deleted`), `reassign(ctx, cid, ownerUserId)` (`workspace.type === 'ORGANIZATION'` else `409 NOT_AN_ORGANIZATION`; target membership rule; audit `course.reassigned { ownerUserId }` before/after).
- Controller `workspaces/:wid/courses`: routes of spec §7; `GET :cid` and `GET :cid/structure` (structure arrives in T6; here `GET :cid` only) set `ETag`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/courses/courses.e2e-spec.ts
it('a teacher creates a DRAFT course with the workspace defaults; list/tabs; a student gets 403 on the workspace routes', …);
it('PATCH needs If-Match: 428 without, 409 VERSION_CONFLICT with the current version on a stale one, ETag follows (AC-CRS-03)', async () => {
  await agent.patch(url).send({ title: 'B' }).expect(428).expect(({ body }) => expect(body.code).toBe('VERSION_REQUIRED'));
  await agent.patch(url).set('If-Match', '"1"').send({ title: 'B' }).expect(200).expect('ETag', '"2"');
  const res = await agent.patch(url).set('If-Match', '"1"').send({ title: 'C' }).expect(409);
  expect(res.body).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 2 } });
  await agent.patch(url).set('If-Match', '"2"').send({ title: 'C' }).expect(200).expect('ETag', '"3"'); // « écraser »
});
it('scope own: an org TEACHER sees and edits only his courses; ADMIN sees all; reassign is ADMIN-only and ORGANIZATION-only', …);
it('storage reports reservedBytes of UPLOADING assets', …);
// test/courses/course-lifecycle.e2e-spec.ts
it('publish refuses a course without a READY lesson, listing the blockers (AC-CRS-01)', async () => {
  const res = await agent.post(`${url}/publish`).expect(422);
  expect(res.body).toMatchObject({ code: 'COURSE_NOT_PUBLISHABLE', details: { missing: ['NO_MODULE'] } });
  // + module with a PROCESSING video lesson → missing ['NO_READY_LESSON']; TEXT lesson → 200 PUBLISHED + one notifications job
});
it('delete: PUBLISHED → 409 COURSE_STATUS_INVALID (hint ARCHIVE_FIRST); ARCHIVED with an ACTIVE enrollment → 409 COURSE_HAS_ACTIVE_ENROLLMENTS (AC-CRS-05); after revoking → 204, deletedAt set, course gone from the list', …);
it('transitions: unpublish keeps enrollments and progress rows (AC-CRS-02 data side); archive/restore; wrong source state → 409 COURSE_STATUS_INVALID; every transition audited', …);
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/api exec vitest run test/courses src/common/if-match` — Expected: FAIL.
- [ ] **Step 3: Implement**; regenerate OpenAPI.
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/api --filter=@nibras/contracts --concurrency=2 && pnpm --filter @nibras/api exec vitest run test/isolation && git diff --exit-code packages/contracts` — Expected: PASS (the isolation suite covers the new routes with the fixtures; no exemption).
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): courses module — CRUD with If-Match optimistic locking, publish/unpublish/archive/restore/delete rules, reassign, isolation fixtures"
```

---

### Task 6: API structure — modules, lessons, reorder under deferred constraints, rich text, version races

Depends on T5. Media rows are created through factories until T7 wires uploads.

**Files:**

- Create: `apps/api/src/structure/{structure.module.ts,modules.controller.ts,lessons.controller.ts,structure.service.ts,rich-text.service.ts,dto.ts}`, `apps/api/test/structure/modules.e2e-spec.ts`, `apps/api/test/structure/lessons.e2e-spec.ts`, `apps/api/test/structure/reorder.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/audit/audit.service.ts` (`module.*`, `lesson.*`), `apps/api/src/courses/courses.controller.ts` (`GET :cid/structure` delegates to `StructureService.structure`), `apps/api/test/isolation/fixtures.ts` (`:mid`, `:lid` fixtures of B; `FOREIGN_BODIES`: lesson create/patch with B's `mediaAssetId`, TEXT content with B's image `mediaId`, reorder with B's ids), `apps/api/test/helpers/invariants.ts`
- Test: the three specs

**Interfaces:**

- `StructureService` (every write: `withTenantTx` → `loadCourseForWrite` (row lock) → `assertVersion` → mutate → bump course (+ module) versions → audit): `structure(ctx, cid)` → `CourseStructure` (one query with nested `include`, lessons ordered by position, `media` projection); `createModule(ctx, cid, input, expectedVersion)` (`position = count + 1`), `updateModule`, `deleteModule` (cascades lessons; renumbers the remaining modules in the same tx; a lesson's media is never deleted here), `reorderModules(ctx, cid, ids, expectedVersion)` (the id set must equal the course's module set, else `422 VALIDATION_FAILED` path `ids`; `SET CONSTRAINTS "module_course_position_key" DEFERRED` then one `UPDATE` per row — or the two-phase fallback recorded by T1), `createLesson(ctx, mid, input, expectedVersion)` (content rules of spec §4.2: `mediaAssetId` → `tenantDb(wid).mediaAsset` with `kind` matching the type (`422 MEDIA_KIND_MISMATCH`), status `READY | PROCESSING` (`409 MEDIA_NOT_READY` otherwise), `deletedAt: null`; TEXT: `RichTextService.validate(content)` → image ids must be READY IMAGE assets of the workspace (`422` path `content`)), `updateLesson`, `deleteLesson` (renumber), `reorderLessons(ctx, mid, ids, expectedVersion)`; `lesson(ctx, lid)` → `LessonDetail` with `images` presigned 5 min.
- `RichTextService.validate(doc, { allowImages })` → parsed doc + `imageIds`; shared with T5's description (course create/update now validates `description` through it — T5 used the zod schema only; T6 swaps in the service, no behaviour change).
- `allowDownload` default from `readSettings(workspace).default_pdf_download` when the PDF variant omits it.
- `expectStructureInvariant(db, courseId)`: positions contiguous from 1 per parent, no duplicates, every lesson's content matches its type, every referenced media belongs to the course's workspace.

- [ ] **Step 1: Write the failing tests**

```ts
// reorder.e2e-spec.ts
it('reorders 5 lessons in one transaction without a unique violation; positions 1..5; course version +1 (AC-CRS-04)', async () => {
  const ids = lessons.map((l) => l.id).reverse();
  await agent.post(`${mod}/lessons/reorder`).set('If-Match', `"${v}"`).send({ ids }).expect(200).expect('ETag', `"${v + 1}"`);
  const rows = await ctx.db.lesson.findMany({ where: { moduleId: mid }, orderBy: { position: 'asc' } });
  expect(rows.map((r) => r.id)).toEqual(ids); await expectStructureInvariant(ctx.db, cid);
});
it('refuses a partial or foreign id set (422), keeps positions; two concurrent lesson creations with the same If-Match → one 201, one 409 (Review Focus 1)', …); // Promise.all over the HTTP app
// lessons.e2e-spec.ts
it('VIDEO/PDF need a media of the right kind and workspace: wrong kind → 422 MEDIA_KIND_MISMATCH, FAILED media → 409 MEDIA_NOT_READY, PROCESSING accepted, B's media → 404 (Review Focus 5)', …);
it('TEXT content: whitelist refuses an iframe node and a javascript: link; images must be READY IMAGE assets of the workspace; the detail returns images as presigned URLs', …);
it('PDF allowDownload defaults from workspace settings; type is immutable (422)', …);
// modules.e2e-spec.ts: create appends, unlock rule AFTER_DATE → 422, delete renumbers and cascades lessons, structure lists media statuses, every write audited and bumps the course version
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/api exec vitest run test/structure` — Expected: FAIL.
- [ ] **Step 3: Implement**; regenerate OpenAPI.
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/api --concurrency=2 && pnpm --filter @nibras/api exec vitest run test/isolation && git diff --exit-code packages/contracts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): modules and lessons — create/update/delete, drag-and-drop reorder under deferred unique constraints, typed content with rich-text whitelist, version bumps"
```

---

### Task 7: API media — uploads, resume, complete with signature and quota, playback, download, delete, webhooks

Depends on T6. Uses the real MinIO (D10).

**Files:**

- Create: `apps/api/src/media/{media.module.ts,media.controller.ts,media.service.ts,upload.service.ts,playback.service.ts,signature.ts,quota.service.ts,webhooks.controller.ts,dto.ts}` (+ `signature.spec.ts`), `apps/api/test/media/uploads.e2e-spec.ts`, `apps/api/test/media/playback.e2e-spec.ts`, `apps/api/test/media/webhooks.e2e-spec.ts`, `apps/api/test/media/fixtures.ts` (`PDF_BYTES` (a 2-page minimal PDF built in code), `PNG_BYTES`, `MP4_BYTES` (from the providers' `buildMp4` fixture, exported from `@nibras/providers` under a `/testing` subpath? — no: copy the ~40-line builder into the test helper), `EXE_BYTES` (`MZ…`)), `apps/api/test/helpers/media.ts` (`uploadThroughApi(agent, wid, { kind, filename, mimeType, bytes })` → performs the ticket, the `PUT`s with `fetch`, `complete`; returns the asset)
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/audit/audit.service.ts` (`media.*`), `apps/api/src/observability/metrics.ts` (`media_playback_issued_total{kind}`, `media_uploads_total{kind,outcome}`), `apps/api/test/isolation/fixtures.ts` (`:mediaId` of B; bodies: `complete` with B's parts is bodyless-equivalent — B's `mediaId` in the path suffices; `POST …/courses` `{ coverMediaId }` completed), `apps/api/test/helpers/invariants.ts` (`expectQuotaInvariant`)
- Test: the three specs + `signature.spec.ts`

**Interfaces:**

- `signature.ts`: `detectSignature(bytes: Uint8Array): Promise<{ mime: string; ext: string } | null>` (`file-type`'s `fileTypeFromBuffer`); `assertSignature(kind, declaredMime, bytes)` → detected mime must be in `MEDIA_MIME_TYPES[kind]` (PDF: `application/pdf`; VIDEO on the S3 provider: `video/mp4` | `video/webm`), else `415 INVALID_FILE_SIGNATURE { detected }`; `MEDIA_KIND_MISMATCH` when the detected mime belongs to another kind.
- `QuotaService`: `assertRoom(tx, wid, bytes)` (under `lockWorkspace`: `used + reserved + bytes ≤ quota` else `402 QUOTA_EXCEEDED { usedBytes, reservedBytes, quotaBytes, requestedBytes }`), `commit(tx, wid, mediaId, bytes)` (`storageUsedBytes += bytes`, `countedBytes = bytes`), `release(tx, wid, mediaId)` (`-= countedBytes`, `countedBytes = 0`).
- `UploadService`: `create(ctx, input)` → ticket (quota, limits, provider mime list; S3 kinds and S3-provider video → `storage.createMultipartUpload`; Cloudflare video → `video.createDirectUpload` → `TUS` ticket, `providerAssetId` stored); `state(ctx, mediaId)` → `UploadState` (`UPLOADING` and not expired else `410 UPLOAD_EXPIRED` / `409 UPLOAD_NOT_PENDING`; fresh URLs for the parts not in `listParts`); `complete(ctx, mediaId, parts)` → the sequence of spec §4.3 (parts optional: when omitted, `listParts` is used), `PROCESSING`, `processingStartedAt`, enqueue `MEDIA_PROCESS_JOB` (`jobId = mediaProcessJobId`), audit `media.completed`; TUS `complete` → no-op `200` returning the asset.
- `MediaService`: `get(ctx, mediaId)` (+ `usedBy`), `list(ctx, q)`, `remove(ctx, mediaId)` (`usedBy` non-empty → `409 MEDIA_IN_USE { lessons }`; `UPLOADING` → abort multipart and hard delete now; otherwise `DELETING` + `MEDIA_DELETE_JOB`; audit `media.deleted`).
- `PlaybackService`: `playback(userId, wid, asset)` → window `playback:{userId}` (`hitWindow`, 3600 s, `> PLAYBACK_TOKENS_PER_HOUR` → `rateLimited` + `warn` log `media.playback_rate_exceeded`), VIDEO → `video.signPlayback`, PDF → `storage.signGetUrl(inline)`; log `info` `media.playback_issued`; metric; `download(userId, wid, asset, filename)` → attachment URL. Teacher routes use them with `allowDownload` irrelevant (teachers always may); the student rule lives in T10.
- `WebhooksController` `POST webhooks/media/:provider` (`@Public()`, `@Throttle` anon window applies): `provider !== video.name.toLowerCase()` → `404`; `video.verifyWebhook({ rawBody: req.rawBody, headers })` → `401 WEBHOOK_SIGNATURE_INVALID { reason }`; `db.webhookEvent.create` (unique violation → `200 { received: true, duplicate: true }`), enqueue `MEDIA_WEBHOOK_PROCESS_JOB` (`jobId = webhookProcessJobId(id)`), `200 { received: true, duplicate: false }`.
- Logging: no response body logging exists; the test asserts no presigned URL substring (`X-Amz-Signature`) appears in `logs.lines()`.

- [ ] **Step 1: Write the failing tests**

```ts
// uploads.e2e-spec.ts (real MinIO)
it('PDF multipart: ticket → parts PUT → complete → PROCESSING, media.process job, quota committed with the actual size (AC-MED-07 data side)', …);
it('resume: after uploading part 1 of 2 the state endpoint lists it and signs only part 2; completing with both works (AC-MED-01)', …); // 5 MiB + tail; UPLOADING in between
it('signature: bytes MZ declared application/pdf → 415 INVALID_FILE_SIGNATURE, object gone, asset FAILED; a PDF declared image/png → 422 MEDIA_KIND_MISMATCH (Review Focus 3, AC-MED-04)', …);
it('quota: 20 GiB personal workspace, three 10 GiB declared uploads → third 402 with usage; a complete that overshoots → 402, object deleted (Review Focus 2); expectQuotaInvariant', …); // set storageQuotaBytes small via systemPrisma for the complete case
it('limits and mime: VIDEO over 4 GiB → 422; video/x-matroska on the s3 provider → 422; verified-teacher gate on uploads (TEACHER_NOT_VERIFIED)', …);
it('TUS mode with FakeVideoProvider (overrideProvider VIDEO_PROVIDER_TOKEN): ticket carries uploadUrl and the asset stores providerAssetId; complete is a no-op', …);
it('delete: referenced by a published lesson → 409 MEDIA_IN_USE with the lessons (AC-MED-08); unreferenced READY → DELETING + media.delete job; UPLOADING → removed at once', …);
// playback.e2e-spec.ts
it('teacher playback: PDF inline URL 5 min, MP4 presigned 2 h on the s3 provider; download attachment; 31st token in an hour → 429 and a warn log; no presigned URL in the logs', …);
// webhooks.e2e-spec.ts (overrideProvider with a CloudflareStreamProvider configured with webhookSecret 'test-secret')
it('valid signature → 200 + WebhookEvent + one job; replay → 200 duplicate, no second job; stale time / bad sig → 401, no row (Review Focus 6, AC-MED-02 idempotence)', …);
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/api exec vitest run test/media src/media` — Expected: FAIL.
- [ ] **Step 3: Implement** — `pnpm --filter @nibras/api add file-type@22.2.0`; the module; OpenAPI.
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/api --concurrency=2 && pnpm --filter @nibras/api exec vitest run test/isolation && git diff --exit-code packages/contracts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): media module — resumable S3 multipart and tus tickets, complete with signature and quota checks, playback and download URLs with a 30/h window, deletion rules, verified VOD webhooks"
```

---

### Task 8: Worker media — process, webhook processing, cleanup scheduler, delete, teacher email

Depends on T7.

**Files:**

- Create: `apps/worker/src/processors/media.processor.ts`, `apps/worker/src/media/{process.ts,cleanup.ts,delete.ts,pdf.ts,image.ts}`, `apps/worker/test/media.e2e-spec.ts`, `apps/worker/test/fixtures/media.ts` (PDF/PNG/MP4/encrypted-PDF byte builders — `pdf-lib` can produce the encrypted fixture? it cannot encrypt; use a hand-written minimal encrypted PDF header with `/Encrypt` in the trailer; `pdf-lib` throws `EncryptedPDFError` without `ignoreEncryption`)
- Modify: `apps/worker/src/worker.module.ts`, `apps/worker/src/schedulers.ts` (`media-cleanup-abandoned` hourly `HOURLY_SCHEDULER_PATTERN` on `media`), `apps/worker/package.json` (`pdf-lib@1.17.1`, `image-size@2.0.4`), `packages/providers/src/email/types.ts` (`'media.failed': Name & { filename: string; reason: string; link: string }`), `packages/providers/src/email/templates.test.ts` (`SAMPLE_PARAMS`), `packages/i18n/messages/{fr,ar,en}.json` (`emails.media.failed.*`: « Le traitement de {filename} a échoué ({reason}). Vous pouvez réessayer l'envoi depuis l'éditeur de cours. »)
- Test: `apps/worker/test/media.e2e-spec.ts`, providers templates test

**Interfaces:**

- `MediaProcessor.onModuleInit` registers the four jobs on `QUEUES.media`.
- `process({ mediaId })`: asset `PROCESSING` else no-op; by kind: PDF → `getRange` whole object (≤ 50 MiB) → `PDFDocument.load(bytes)` → `pageCount`; `EncryptedPDFError` → `FAILED 'ENCRYPTED'`; IMAGE → `imageSize(bytes)` → width/height; VIDEO (S3) → `video.getAsset({ storageKey })` → `READY` with duration/width/height, `durationS > MEDIA_LIMITS.VIDEO.maxDurationS` → `FAILED 'SIZE_MISMATCH'`; → `READY`, `readyAt`, `mimeType` kept; failures email the owner (`media.failed`, link = `courseEditorLink`? the asset may not be in a course: link to `/{locale}/app/w/{wid}/courses`) with `sentTo` progress.
- `webhookProcess({ webhookEventId })`: load the event (`processedAt` set → no-op); re-verify nothing (verified at receipt); for each event: asset by `(provider, providerAssetId)`; `READY` → only from `UPLOADING | PROCESSING` → `READY` + numbers + `sizeBytes` + quota commit (`countedBytes` from `sizeBytes`, under `lockWorkspace` through `withTenantTx`? the worker uses the BYPASSRLS client: do the `UPDATE workspace SET storage_used_bytes = storage_used_bytes + $1` in a `$transaction` with the asset update); `FAILED` → from `UPLOADING | PROCESSING` → `FAILED 'PROVIDER_ERROR'` (`failureReason` text in the log only) + email; `PROCESSING` → `UPLOADING → PROCESSING` (`processingStartedAt`); mark `processedAt`; a `READY` for a `FAILED` asset is ignored (logged).
- `cleanup()`: `UPLOADING` with `createdAt < now − 24 h` → abort multipart / `video.delete` (TUS) → `FAILED 'ABANDONED'`; `PROCESSING` with `processingStartedAt < now − 6 h` → Cloudflare: `getAsset` first and apply it (R11); still not ready → `FAILED 'TIMEOUT'` + email; writes `writeSystemAudit('media.failed', …)` per asset; returns counts.
- `remove({ mediaId })`: asset `DELETING` else no-op; `video.delete` / `storage.delete` (404 tolerated); `$transaction`: quota release, `mediaAsset.delete`; a provider error throws (BullMQ retries; the row stays `DELETING`).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/worker/test/media.e2e-spec.ts (MinIO + WORKER_DB)
it('process: PDF → READY with pageCount 2; encrypted PDF → FAILED ENCRYPTED + email media.failed to the owner; PNG → width/height; MP4 → duration from the probe; READY asset → no-op', …);
it('webhook process: ready event → READY with duration and sizeBytes counted in the quota; error event → FAILED PROVIDER_ERROR + email; a ready after FAILED is ignored; processedAt set; second run no-op (Review Focus 6)', …);
it('cleanup: UPLOADING older than 24 h → FAILED ABANDONED and the multipart aborted; PROCESSING older than 6 h → FAILED TIMEOUT + email (AC-MED-03); a Cloudflare PROCESSING asset that getAsset reports READY is reconciled instead', …); // FakeVideoProvider for the last case
it('delete: provider delete then row removal and quota release; a provider failure leaves DELETING and throws', …);
it('scheduler media-cleanup-abandoned is upserted hourly', …);
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/worker exec vitest run test/media` — Expected: FAIL.
- [ ] **Step 3: Implement**; add the template and keys; `pnpm turbo run build --filter=@nibras/providers --concurrency=2`.
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/worker --filter=@nibras/providers --filter=@nibras/i18n --concurrency=2` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(worker,providers): media processors — PDF/image/MP4 processing, VOD webhook state machine, hourly abandon/timeout cleanup with reconciliation and teacher email, provider deletion"
```

---

### Task 9: API enrollments — batch assign, revoke, SP2 hooks (invitation and invite-link courseIds), notification jobs, students list fill

Depends on T7 (media factories not needed; courses from T5). Touches SP2 files.

**Files:**

- Create: `apps/api/src/enrollments/{enrollments.module.ts,enrollments.controller.ts,enrollments.service.ts,enrollment-hooks.listener.ts,events.ts,dto.ts}`, `apps/api/test/enrollments/enrollments.e2e-spec.ts`, `apps/api/test/enrollments/hooks.e2e-spec.ts`, `apps/worker/src/processors/course-notify.processor.ts`, `apps/worker/test/course-notify.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/audit/audit.service.ts` (`enrollment.*`), `apps/api/src/members/events.ts` (`INVITE_LINK_JOINED` + `InviteLinkJoinedEvent(workspaceId, inviteLinkId, userId)`), `apps/api/src/invite-links/join.service.ts` (emit after commit, next to `MembershipActivatedEvent`; + one assertion in SP2's join spec), `apps/api/src/students/students.service.ts` (`courses` and `progressPercent` from enrollments: list → one `enrollment.findMany({ where: { studentUserId: { in } }, include: { course: { select: { id, title, status } } } })` under `tenantDb`; `progressPercent` = mean over ACTIVE enrollments of PUBLISHED/ARCHIVED courses, rounded down, `null` when none; profile → `courses: StudentCourse[]`), `packages/contracts/src/students.ts` (types), `apps/api/test/students/*.e2e-spec.ts` (SP2 assertions `courses: []` stay valid; one new case), `apps/api/test/isolation/fixtures.ts` (`:uid` on enrollments → B's student; `FOREIGN_BODIES` `POST …/enrollments { studentUserIds: [B's student] }`), `apps/worker/src/worker.module.ts`, `packages/providers/src/email/types.ts` (`'course.assigned': Name & { courseTitle; teacherName; workspaceName; link }`, `'course.published': same`), `packages/providers/src/email/templates.test.ts`, `packages/i18n/messages/*.json` (`emails.course.assigned.*`, `emails.course.published.*`)
- Test: the two API specs, the worker spec, SP2 students/join specs

**Interfaces:**

- `EnrollmentsService.enroll(ctx, cid, studentUserIds, source = 'MANUAL')` → `withTenantTx`: course (`deletedAt: null`, owner filter, `ARCHIVED` → `409 COURSE_STATUS_INVALID`); memberships of the ids: role `STUDENT`, status `ACTIVE | PENDING_GUARDIAN_CONSENT | SUSPENDED_NO_CONSENT` (consent-pending students may be pre-assigned, access waits for consent), else `422 VALIDATION_FAILED` with `issues[].path = ['studentUserIds', i]`; scope `own` → every id in `ownScope` (assignment or invited-by) else `422`; upsert per id (`REVOKED → ACTIVE` keeps `progressPercent`, sets `activatedAt`, clears `revokedAt`); audit `enrollment.created` per created/reactivated row; after commit: `PUBLISHED` → enqueue `COURSE_ASSIGNED_NOTIFY_JOB { workspaceId, enrollmentIds }` + `CourseAssignedEvent`.
- `revoke(ctx, cid, uid, reason?)` → `ACTIVE → REVOKED`, audit `enrollment.revoked`, `EnrollmentRevokedEvent(workspaceId, courseId, studentUserId)`; already revoked → `204` idempotent; none → `404`.
- `list(ctx, cid, q)` → `EnrollmentsPage` (names through `student` relation inside `tenantDb` — allowed: `Enrollment.student` is a non-tenant model).
- `EnrollmentHooksListener`: `@OnEvent(INVITATION_ACCEPTED, { async: true })` → load the invitation under `tenantDb(wid)` (`courseIds`), `enroll` with a system ctx (`scope: 'all'`, `userId = invitedByUserId`, `source: 'INVITATION'`), skipping ids that are not non-deleted courses of the workspace (log `warn`); `@OnEvent(INVITE_LINK_JOINED)` → same with `inviteLink.courseIds`, `source: 'INVITE_LINK'`, `assignedBy = createdByUserId`. Errors are logged, never thrown into the request.
- Worker `CourseNotifyProcessor`: `course.assigned_notify` → for each enrollment still `ACTIVE` with a `PUBLISHED` course and an `ACTIVE` student membership: email `course.assigned` (`sentTo` progress); `course.published_notify` → every `ACTIVE` enrollment of the course (same filters) gets `course.published`; a course no longer `PUBLISHED` at run time → no-op.

- [ ] **Step 1: Write the failing tests**

```ts
// enrollments.e2e-spec.ts
it('assigning a PUBLISHED course creates ACTIVE enrollments, one notifications job with the ids, audit rows; re-assigning is idempotent (AC-ENR-01 data side)', …);
it('assigning a DRAFT course creates enrollments but no job; publishing enqueues course.published_notify once per version (AC-ENR-02)', …);
it('revoke → REVOKED + event; re-assign → ACTIVE with progressPercent intact (AC-ENR-05)', …); // set progressPercent 40 via systemPrisma before revoking
it('scope own: an org TEACHER can assign only his courses to students assigned to him (422 with the offending index); a non-student id → 422; ARCHIVED → 409; B\'s student → 422/404', …);
// hooks.e2e-spec.ts
it('accepting an invitation with courseIds enrolls the student (source INVITATION, assignedBy inviter); unknown or deleted ids are skipped; a join through an invite link with courseIds enrolls too (INVITE_LINK)', …); // drives SP2\'s public accept/join routes end to end
it('students list and profile carry courses and progressPercent (mean of ACTIVE enrollments)', …);
// apps/worker/test/course-notify.e2e-spec.ts: assigned → one email per active enrollment naming course, teacher and workspace in the student\'s locale; a revoked enrollment or an unpublished course is skipped; retry after failFor emails the rest once (sentTo)
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/api exec vitest run test/enrollments test/students && pnpm --filter @nibras/worker exec vitest run test/course-notify` — Expected: FAIL.
- [ ] **Step 3: Implement**; templates + keys; OpenAPI.
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/api --filter=@nibras/worker --filter=@nibras/providers --filter=@nibras/i18n --filter=@nibras/contracts --concurrency=2 && pnpm --filter @nibras/api exec vitest run test/isolation test/invite-links test/invitations && git diff --exit-code packages/contracts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api,worker): enrollments — batch assign and revoke, invitation and invite-link courseIds hooks, course assigned/published emails, students list with courses and progress"
```

---

### Task 10: API learn — `/me/courses`, structure with locks, lesson content and playback, minimal progress

Depends on T9.

**Files:**

- Create: `apps/api/src/learn/{learn.module.ts,learn.controller.ts,learn.service.ts,access.ts,lock.service.ts,progress.service.ts,dto.ts}` (+ `lock.service.spec.ts` unit tests on pure data), `apps/api/test/learn/my-courses.e2e-spec.ts`, `apps/api/test/learn/locks.e2e-spec.ts`, `apps/api/test/learn/lesson-access.e2e-spec.ts`, `apps/api/test/learn/progress.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/test/isolation/admin-routes.e2e-spec.ts`? (no — `/me` routes are not admin routes; the isolation suite does not enumerate `/me`: `lesson-access.e2e-spec.ts` carries the cross-workspace cases explicitly)
- Test: the four specs + the unit spec

**Interfaces:**

- `access.ts`: `resolveCourseAccess(userId, courseId)` / `resolveLessonAccess(userId, lessonId)` as spec §4.6 (lesson: `crossTenantDb().lesson.findUnique({ where: { id } })` is allowed by the `id` rule → `courseId` through `module` is a tenant relation (forbidden `include`) → two steps: lesson by id (select `moduleId`, `workspaceId`), module by id, then `resolveCourseAccess`), returning `{ wid, course, enrollment, membership }`; status mapping reused from SP2 (`403 GUARDIAN_CONSENT_REQUIRED` / `MEMBERSHIP_INACTIVE`).
- `LockService.evaluate({ course, modules (with lessons and progress rows) })` → per module `{ percent, locked, lock }`, per lesson `{ locked, lock }` (rules of spec §4.6; `percent` of a module = `courseProgressPercent(completed required, required)`; optional modules show their own percent but never gate); pure function `evaluateLocks(input)` exported for the unit spec.
- `ProgressService`: `opened(userId, lid)`, `complete(userId, lid)`, `uncomplete(userId, lid)` → `withTenantTx(wid)` after `resolveLessonAccess` + lock check (a locked lesson → `403` even for `opened`); upsert `LessonProgress`; `recompute(tx, wid, courseId, studentUserId)` → `Enrollment.progressPercent`, `completedAt` (set once at 100, kept), `lastActivityAt = now`; returns `ProgressActionResult`. PDF `complete` without `openedAt` → `409 LESSON_NOT_OPENED`. `PROCESSING` media → `opened` returns `409 MEDIA_NOT_READY`.
- `LearnService`: `myCourses(userId)` (enrollments by `studentUserId` `ACTIVE` → group by workspace → `tenantDb(wid)` courses `PUBLISHED | ARCHIVED`, memberships `ACTIVE` → items sorted by `lastActivityAt desc, title`), `course(userId, cid)` → `MyCourseDetail` (`next` = first unlocked non-completed lesson in position order), `lesson(userId, lid)` → `MyLessonDetail` (locked → `403` with the lock; TEXT → `content` + `images`; VIDEO/PDF → `playback` via `PlaybackService` when media `READY`, `null` when `PROCESSING`), `playback(userId, lid)` (same, for the silent refresh), `download(userId, lid)` (`allowDownload` else `403 DOWNLOAD_NOT_ALLOWED`).
- Controller `me` sub-routes with `@CrossTenant()`: spec §7 list.

- [ ] **Step 1: Write the failing tests**

```ts
// locks.e2e-spec.ts
it('PREVIOUS_MODULE_COMPLETED: module 1 at 80 % (4/5 required completed) → opening a module-2 lesson is 403 MODULE_LOCKED { reason: PREVIOUS_MODULE_INCOMPLETE, previousModule: { percent: 80 } }; completing the 5th unlocks (AC-ENR-03)', …);
it('optional modules never gate; an optional lesson never blocks sequential lessons; sequential: lesson 2 → 403 LESSON_LOCKED until lesson 1 is COMPLETED (Review Focus 4)', …);
// lesson-access.e2e-spec.ts
it('not enrolled → 404; REVOKED → 403 ENROLLMENT_REVOKED; DRAFT or unpublished course → 403 COURSE_NOT_AVAILABLE and gone from /me/courses, enrollment and progress untouched (Review Focus 7, AC-CRS-02); consent-pending membership → 403 GUARDIAN_CONSENT_REQUIRED; a lesson of another workspace where the user is not enrolled → 404', …);
it('playback: enrolled student gets a 2 h MP4/HLS grant for a video and a 5 min inline URL for a PDF; download refused unless allowDownload (AC-MED-05 issuance side, AC-MED-06); the 31st request in an hour → 429', …);
// progress.e2e-spec.ts
it('opened → IN_PROGRESS; complete a PDF before opening → 409 LESSON_NOT_OPENED; complete → COMPLETED and Enrollment.progressPercent 50 (1 of 2 required, optional ignored); uncomplete → back; completedAt set at 100 and kept after uncomplete; lastActivityAt updated', …);
// my-courses.e2e-spec.ts: courses across two workspaces with teacher names and progress; an ARCHIVED course listed read-only; next lesson computed
// lock.service.spec.ts: evaluateLocks table-driven (6 cases)
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/api exec vitest run test/learn src/learn` — Expected: FAIL.
- [ ] **Step 3: Implement**; OpenAPI.
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/api --concurrency=2 && git diff --exit-code packages/contracts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): learn routes — my courses, structure with module and sequential locks, lesson content, playback and download for enrolled students, manual completion and progress percent"
```

---

### Task 11: Web — nav, course list, create dialog, course page shell, settings form, conflict dialog

Depends on T10 (contracts). First web task.

**Files:**

- Create: `apps/web/src/app/[locale]/(app)/app/w/[wid]/courses/{page,loading}.tsx`, `courses/[cid]/{layout,page,loading}.tsx` (layout: course header + tabs Structure · Étudiants · Paramètres as link tabs `?tab=` → no: three nested routes `courses/[cid]` (structure), `courses/[cid]/students`, `courses/[cid]/settings`), `courses/[cid]/students/page.tsx` (placeholder until T14), `courses/[cid]/settings/page.tsx`, `apps/web/src/components/courses/{courses-panel,create-course-dialog,course-header,course-settings-form,version-conflict-dialog,course-status-badge}.tsx` (+ `.test.tsx`), `apps/web/src/lib/courses.ts` (`useCourseVersion` store: the `version` held per course page, bumped from every response's `ETag`; `withIfMatch(version)` helper for `api.PATCH/POST` headers)
- Modify: `apps/web/src/lib/navigation.ts` (+ `.test.ts`: main item « Cours » (`/app/courses`) when any membership is `STUDENT`; workspace section « Cours » (`/app/w/{wid}/courses`) for OWNER/ADMIN/TEACHER, in PRD §9.1 order after the settings item), `apps/web/src/app/[locale]/(app)/app/w/[wid]/workspace-tabs.tsx` (Cours tab, role-gated), `apps/web/src/components/onboarding-checklist.tsx` (`firstCourse` live → `/app/w/{personalWid}/courses` — the first PERSONAL or teaching workspace), `packages/i18n/messages/{fr,ar,en}.json` (`courses.*`, `errors.VERSION_CONFLICT` « Ce cours a été modifié dans un autre onglet. », `errors.COURSE_NOT_PUBLISHABLE`, `errors.COURSE_HAS_ACTIVE_ENROLLMENTS`, `errors.COURSE_STATUS_INVALID`, `errors.VERSION_REQUIRED`, `errors.MEDIA_*`, `errors.QUOTA_EXCEEDED`, `errors.*LOCKED`, `errors.ENROLLMENT_REVOKED`, `errors.COURSE_NOT_AVAILABLE`, `errors.DOWNLOAD_NOT_ALLOWED`, `errors.LESSON_NOT_OPENED`, `errors.INVALID_FILE_SIGNATURE`, `errors.UPLOAD_EXPIRED`)
- Test: component tests, `navigation.test.ts`, i18n tests

**Interfaces:**

- `CoursesPanel({ wid, detail, meId })`: tabs Tous · Brouillons · Archivés (`status` filter), search (`useAbortableQuery`), table (title, status badge, modules/lessons/enrolled counts, updated), empty state « Créez votre premier cours », « + Créer » → `CreateCourseDialog` (title, level `Select`, language, sequential `Switch`) → navigates to the new course.
- `CourseHeader({ course, grant, onChanged })`: `PageHeader` with status badge, actions menu per state: Publier (shows blockers from `publishBlockers` as a disabled reason), Dépublier, Archiver, Restaurer, Supprimer (PUBLISHED → « Archiver puis supprimer » runs archive then delete after one `AlertDialog`), Réaffecter (ADMIN, org: dialog listing teachers); every action refreshes the course and the `version`.
- `CourseSettingsForm`: fields of `UpdateCourseSchema` (description via the T13 editor; until then a `Textarea` bound to a single-paragraph doc — T13 swaps it); submit with `If-Match`; on `409 VERSION_CONFLICT` → `VersionConflictDialog` (« Recharger » reloads the course and drops local edits; « Écraser » re-sends with `currentVersion`) — AC-CRS-03 UI.
- Course layout fetches `GET /workspaces/{wid}/courses/{cid}` server-side, passes `course` + `version` to a client `CourseProvider` (context) used by the tabs.

- [ ] **Step 1: Write the failing tests**

```ts
// courses-panel.test.tsx: renders rows, filters by status tab, empty state CTA, create dialog posts and navigates
// course-header.test.tsx: actions by status and grant (TEACHER own vs ADMIN; no write actions on a SUSPENDED workspace); « Archiver puis supprimer » calls archive then delete
// version-conflict-dialog.test.tsx: Recharger → reload callback; Écraser → resubmit with the given version
// navigation.test.ts: « Cours » main item only with a STUDENT membership; workspace « Cours » for OWNER/TEACHER, not STUDENT
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/web exec vitest run src/components/courses src/lib/navigation` — Expected: FAIL.
- [ ] **Step 3: Implement**; keys in the three catalogues.
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/web --filter=@nibras/i18n --concurrency=2` — Expected: PASS. Manual: `pnpm dev` → create a course → publish refused with the blockers listed → settings save → open a second tab, save in both → conflict dialog.
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): courses list and course page — create, status actions with archive-then-delete, settings with If-Match and the version-conflict dialog, nav entries"
```

---

### Task 12: Web — structure editor (dnd-kit), lesson dialogs, upload engine with resume, media states

Depends on T11.

**Files:**

- Create: `apps/web/src/lib/upload/{engine.ts,s3-multipart.ts,tus.ts,resume-store.ts}` (+ `s3-multipart.test.ts`, `resume-store.test.ts`), `apps/web/src/components/courses/{structure-panel,sortable-list,module-dialog,lesson-dialog,media-picker,upload-dialog,media-state-chip}.tsx` (+ tests), `apps/web/src/lib/use-media-status.ts` (polls `GET …/media/{id}` every `MEDIA_STATUS_POLL_MS` while `PROCESSING | UPLOADING`, stops on `READY | FAILED`, pauses when `document.hidden`)
- Modify: `apps/web/package.json` (`tus-js-client@4.3.1`, `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2`), `courses/[cid]/page.tsx` (renders `StructurePanel`), `packages/i18n/messages/*.json` (`structure.*`, `upload.*`: « Reprendre l'envoi », « Traitement en cours », « Échec du traitement : {reason} », « Réessayer »)
- Test: the lib tests and component tests

**Interfaces:**

- `s3-multipart.ts`: `uploadS3Multipart({ file, ticket, state?, signal, onProgress, fetchState: () => Promise<UploadState> })` → slices by `partSizeBytes`, 3 concurrent `PUT`s (`fetch`, `ETag` header read; a `PUT` without a readable `ETag` → error « CORS: ETag not exposed » with a runbook hint), per-part retry ×3 with backoff, `done` parts persisted through `resume-store` after each success, asks `fetchState` for fresh URLs when a batch is exhausted or a URL is older than 50 min; returns `parts` for `complete`.
- `resume-store.ts`: `localStorage` `nibras-upload:{mediaId}` `{ mediaId, fileName, size, lastModified, done: number[] }`; `findResumable(file)` scans keys; try/catch everywhere.
- `tus.ts`: `uploadTus({ file, uploadUrl, onProgress, signal })` with `tus-js-client` (`uploadUrl` as the resumable URL, `chunkSize` 50 MiB, `retryDelays`, `storeFingerprintForResuming: true`).
- `engine.ts`: `startUpload({ wid, kind, file, api })` → `POST /media/uploads` → mode dispatch → `complete` → returns `MediaAsset`; `resumeUpload(file)` when `findResumable(file)` matches (name + size + lastModified) → `GET …/upload` → continue.
- `StructurePanel`: modules as `SortableList` (dnd-kit `DndContext` + `SortableContext`, `KeyboardSensor` with `sortableKeyboardCoordinates`, announcements translated, a « Monter / Descendre » menu fallback), lessons nested; drop → `POST …/reorder` with `If-Match`; `ModuleDialog` (title, description, optional, unlock rule select NONE / PREVIOUS_MODULE_COMPLETED), `LessonDialog` (type picker on create: Vidéo / PDF / Texte; VIDEO/PDF → `MediaPicker` (existing READY/PROCESSING assets of the workspace, or « Envoyer un fichier » → `UploadDialog`); PDF `allowDownload` switch; TEXT → the T13 editor, a `Textarea` placeholder until then), delete with `AlertDialog`; each lesson row shows `MediaStateChip` (`UPLOADING`, « Traitement en cours » (polling), `READY` with duration/pages, « Échec » with reason + « Réessayer » → new upload replacing `mediaAssetId`).
- `UploadDialog`: file input with `accept` per kind, progress bar (`role="progressbar"`), pause/cancel, « Reprendre l'envoi » when a resumable state matches, quota error (`402`) shown with usage, signature error (`415`) shown with the detected type.

- [ ] **Step 1: Write the failing tests**

```ts
// s3-multipart.test.ts (fetch stub): uploads 3 parts, collects ETags in order, persists done parts, resumes skipping stored parts after fetchState, retries a failed PUT, surfaces a missing ETag as a CORS hint
// resume-store.test.ts: round-trip, matching rule, tolerant of a throwing localStorage
// structure-panel.test.tsx: renders modules/lessons, keyboard reorder (Space, ArrowDown, Space) posts the new order with If-Match, add module/lesson dialogs, processing chip polls (fake timers) and stops at READY
// upload-dialog.test.tsx: progress, 402 message with usage, 415 message, resumable prompt
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/web exec vitest run src/lib/upload src/components/courses` — Expected: FAIL.
- [ ] **Step 3: Implement** (dnd-kit and tus through `next/dynamic` / dynamic `import()` so the course page stays within budget).
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/web --filter=@nibras/i18n --concurrency=2 && pnpm --filter @nibras/web build && pnpm --filter @nibras/web budget` — Expected: PASS, every route < 250 kB. Manual: upload a 20 MB PDF, close the tab at 50 %, reopen, pick the same file → « Reprendre l'envoi » → completes without re-sending the first parts (network tab).
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): course structure editor with drag-and-drop reorder, lesson dialogs by type, resumable S3 multipart and tus upload engine, media processing states"
```

---

### Task 13: Web — rich text editor (Tiptap) and renderer with inline images

Depends on T12.

**Files:**

- Create: `apps/web/src/components/rich-text/{editor,toolbar,renderer,media-image-node}.tsx` (+ `renderer.test.tsx`, `editor.test.tsx`), `apps/web/src/lib/rich-text.ts` (`isEmptyDoc`, `docFromPlainText`)
- Modify: `apps/web/package.json` (`@tiptap/react@3.32.0`, `@tiptap/core@3.32.0`, `@tiptap/pm@3.32.0`, `@tiptap/starter-kit@3.32.0`, `@tiptap/extension-link@3.32.0`), `course-settings-form.tsx` (description → editor without images), `lesson-dialog.tsx` (TEXT → editor with images; inline image upload through the T12 engine, kind IMAGE), `packages/i18n/messages/*.json` (`editor.*` toolbar labels)
- Test: the two tests

**Interfaces:**

- `RichTextEditor({ value, onChange, images?: { wid } , disabled })` (`'use client'`, loaded with `next/dynamic({ ssr: false })` by its consumers): StarterKit limited to the whitelist (`heading.levels [1,2,3]`, no `code`? code mark allowed; `horizontalRule`, `blockquote`, `codeBlock` kept; `strike`, `underline` via StarterKit 3), `Link` (`openOnClick: false`, `protocols: ['http','https']`, `validate: href => /^https?:\/\//.test(href)`), `MediaImageNode` (atom block node `mediaImage` with `mediaId`/`alt`; rendered in the editor through a `NodeView` that fetches the presigned URL via `GET …/media/{id}/playback`... — simpler: the editor receives `images: Record<mediaId, url>` from the lesson detail and the upload result); toolbar with `aria-pressed` buttons; outputs JSON conforming to `RichTextDocSchema` (client-side `safeParse` before submit → inline error).
- `RichText({ doc, images })`: JSON → React (headings, lists, blockquote, code, links with `rel="noopener noreferrer" target="_blank"` and the `common.newTab` sr-only cue, images from `images[mediaId]` with `alt`, a « Image indisponible » placeholder otherwise); unknown node → rendered as nothing (defensive; the API never sends one).

- [ ] **Step 1: Write the failing tests** — `renderer.test.tsx` (every node and mark renders; a `javascript:` href never reaches the DOM; image resolution), `editor.test.tsx` (types text → `onChange` JSON with a paragraph; bold toggle; link dialog refuses `javascript:`).
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/web exec vitest run src/components/rich-text` — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/web --filter=@nibras/i18n --concurrency=2 && pnpm --filter @nibras/web build && pnpm --filter @nibras/web budget` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): rich-text editor (Tiptap, whitelist) and JSON renderer with inline media images for text lessons and course descriptions"
```

---

### Task 14: Web — enrollment panel, assign dialog, student profile courses card and list column

Depends on T11 (course page), SP2's student components.

**Files:**

- Create: `apps/web/src/components/courses/{enrollments-panel,assign-students-dialog}.tsx` (+ tests)
- Modify: `courses/[cid]/students/page.tsx`, `apps/web/src/components/student-profile-panel.tsx` (SP2: « Cours » card: enrolled courses with progress + « Attribuer un cours » dialog listing the workspace's courses in scope + revoke), `apps/web/src/components/students-panel.tsx` (SP2: « Cours » column shows titles (≤ 2 + « +n »), « Progression » column shows `progressPercent`), `packages/i18n/messages/*.json` (`enrollments.*`)
- Test: component tests; SP2's panel tests updated

**Interfaces:**

- `EnrollmentsPanel({ wid, course, grant })`: table (name, status, progress bar, assigned at, actions « Retirer » in an `AlertDialog`); « + Attribuer » → `AssignStudentsDialog` (search over `GET …/students?q` (SP2), checkbox rows, selected count, submit `POST …/enrollments`; `422` issues mapped to row errors); an ARCHIVED course shows no assign button (« Aucune nouvelle attribution sur un cours archivé »).
- Profile card: `GET …/students/{uid}/profile` already returns `courses`; assign dialog lists `GET …/courses?status=PUBLISHED` + DRAFT.

- [ ] **Step 1: Write the failing tests** — `enrollments-panel.test.tsx` (rows, revoke flow, no assign on ARCHIVED), `assign-students-dialog.test.tsx` (search, select, submit body, 422 mapping), SP2 panel tests (courses column/card).
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/web exec vitest run src/components/courses/enrollments src/components/courses/assign src/components/student` — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/web --filter=@nibras/i18n --concurrency=2` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): enrollment panel and assign-students dialog on the course, courses card on the student profile and courses column in the students list"
```

---

### Task 15: Web student — my courses, course outline with locks and progress, lesson shell with text and completion, teacher preview

Depends on T13, T14.

**Files:**

- Create: `apps/web/src/app/[locale]/(app)/app/courses/{page,loading}.tsx`, `courses/[cid]/{page,loading}.tsx`, `courses/[cid]/lessons/[lid]/{page,loading}.tsx`, `apps/web/src/components/learn/{my-courses,course-outline,lesson-shell,lesson-text,complete-button,lesson-state,lesson-nav}.tsx` (+ tests), `apps/web/src/app/[locale]/(app)/app/w/[wid]/courses/[cid]/preview/page.tsx` (renders `CourseOutline` from `GET …/structure` with `preview` mode: no locks, no progress, lesson links to `…/preview/lessons/[lid]` which reuses `LessonShell` with the teacher playback routes)
- Modify: `packages/i18n/messages/*.json` (`learn.*`: « Mes cours », « Continuer », « Terminez le module {title} ({percent} %) », « Terminez la leçon précédente », « Marquer comme terminé », « Annuler terminé », « Cette leçon est en cours de traitement », « Vous n'avez plus accès à ce cours », « Ce cours n'est plus disponible »)
- Test: component tests

**Interfaces:**

- `MyCourses({ items })`: cards (cover or placeholder, title, teacher, workspace, progress bar with `aria-valuenow`, « Terminé » badge), filter by workspace (`Select`), empty state « Aucun cours attribué pour le moment ».
- `CourseOutline({ detail, mode: 'student' | 'preview' })`: PRD §8.6 layout — modules with percent and lock reason, lessons with status icon, type and duration/pages, locked rows not links (`aria-disabled`, reason text), « Continuer » → `next`.
- `LessonShell({ detail, mode })`: header (course › module › lesson), state handling: `403 MODULE_LOCKED | LESSON_LOCKED` → `LessonState` locked with the reason; `MEDIA_NOT_READY` / media `PROCESSING` → « en cours de traitement »; `ENROLLMENT_REVOKED` / `COURSE_NOT_AVAILABLE` → revoked/unavailable states with a link to « Mes cours »; body by type: TEXT → `RichText`; VIDEO/PDF → T16's players (a placeholder `div` with `data-testid` until T16); `CompleteButton` (calls `opened` on mount for TEXT/PDF, complete/uncomplete, updates the course percent in the header); `LessonNav` previous/next.
- Server pages fetch through `serverApi()`; `403`s are turned into the state components, not `notFound()`.

- [ ] **Step 1: Write the failing tests** — `course-outline.test.tsx` (locks rendered with reason, « Continuer » target), `lesson-shell.test.tsx` (states by error code; complete toggles; opened posted on mount), `my-courses.test.tsx` (filter, empty state).
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/web exec vitest run src/components/learn` — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/web --filter=@nibras/i18n --concurrency=2 && pnpm --filter @nibras/web build && pnpm --filter @nibras/web budget` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): student pages — my courses, course outline with locks and progress, lesson shell with text content, completion and navigation; teacher preview"
```

---

### Task 16: Web media — lazy video player and PDF viewer, silent token renewal, watermark, MEDIA_ORIGINS CSP

Depends on T15.

**Files:**

- Create: `apps/web/src/components/learn/{video-player,pdf-viewer,watermark,playback-session}.tsx` (+ `watermark.test.tsx`, `playback-session.test.ts`, `video-player.test.tsx` (jsdom: controls, fullscreen target, renewal on error), `pdf-viewer.test.tsx` (pdfjs mocked)), `apps/web/src/lib/media-origins.ts` (+ `.test.ts`: parses `MEDIA_ORIGINS` (space-separated origins, validated `^https?://[^\s/]+$`), returns `[]` on garbage)
- Modify: `apps/web/package.json` (`hls.js@1.7.3`, `pdfjs-dist@6.4.299`), `apps/web/src/lib/security-headers.ts` (+ `.test.ts`: `buildCsp(nonce, { dev, mediaOrigins })` → `connect-src 'self' <origins>`, `media-src 'self' blob: <origins>`, `img-src 'self' data: blob: <origins>`, `worker-src 'self' blob:`), `apps/web/src/proxy.ts` (reads `process.env.MEDIA_ORIGINS` once), `next.config.ts` (nothing: static headers carry no CSP), `turbo.json` (`build.env` += `MEDIA_ORIGINS`), `.github/workflows/ci.yml` (`MEDIA_ORIGINS: http://localhost:9000`), `.env.example` (`MEDIA_ORIGINS=http://localhost:9000` with the Cloudflare example commented), `lesson-shell.tsx` (mounts the players through `next/dynamic({ ssr: false })`), `apps/web/public/sw.js` (never caches `/api/v1/me/lessons/*/playback` nor media origins — assert the fetch handler ignores cross-origin requests, which it already does; add a comment), `docs/runbooks/frontend.md` (CSP origins paragraph)
- Test: the tests above; `security-headers.test.ts`

**Interfaces:**

- `PlaybackSession({ fetchGrant })` hook: holds `{ url, kind, expiresAt }`, `refresh()` single-flight, auto-refresh at `expiresAt − 60 s` (timer, paused when hidden), `onProviderError()` → refresh once then surface `revoked` when the API answers `403 ENROLLMENT_REVOKED | COURSE_NOT_AVAILABLE` (AC-MED-05 silent re-request).
- `VideoPlayer({ session, title, watermarkText })`: a wrapper `div` (the fullscreen element, `requestFullscreen` on it so the overlay stays), `<video playsInline preload="metadata">` with native source for `MP4` and `hls.js` (`enableWorker: true` — allowed by `worker-src blob:`; native HLS on Safari when `canPlayType('application/vnd.apple.mpegurl')`); own controls (play/pause, seek `input[type=range]` with `aria-valuetext`, volume, speed 0.75–2, fullscreen) — `controls` attribute off so no native menu hides the overlay; keyboard: Space, ←/→ 10 s, F; media error → `session.onProviderError()`; `Watermark` child.
- `PdfViewer({ session, allowDownload, onOpened })`: `pdfjs-dist` loaded dynamically, `GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` (bundled under `_next/static`, `worker-src 'self'`), fetches the inline URL with `fetch` (CORS from the S3 origin), renders pages to canvases lazily (IntersectionObserver), page input, zoom buttons, « Télécharger » (calls `…/download` then navigates); a `403`/`401` on the fetch → `session.refresh()` then retry once (AC-MED-06 silent renewal); fires `onOpened` after the first page renders (→ `opened`); `Watermark` over the pages container.
- `Watermark({ text })`: `aria-hidden`, `pointer-events-none`, `select-none`, absolute, `opacity-40`, text `{email} · {HH:mm}`; position index cycles through `WATERMARK_POSITIONS` every `WATERMARK_MOVE_MS` (`setInterval`), time refreshed every 60 s; styled by class per position (no inline `style` — CSP); `data-testid="watermark"`, `data-position`.

- [ ] **Step 1: Write the failing tests**

```ts
// watermark.test.tsx: renders the email and the time; advances position after 30 s (fake timers) and wraps after 6; has aria-hidden and no interactive element
// playback-session.test.ts: single-flight refresh; auto-refresh at exp − 60 s; provider error → refresh → revoked on 403 ENROLLMENT_REVOKED
// video-player.test.tsx: fullscreen requested on the wrapper, not the video; media error triggers onProviderError; speed changes playbackRate
// pdf-viewer.test.tsx: 403 on fetch → refresh → retry once; onOpened fired; download button only when allowed
// security-headers.test.ts: mediaOrigins appear in connect/media/img-src; worker-src has blob:; garbage origins dropped
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/web exec vitest run src/components/learn src/lib/security-headers src/lib/media-origins` — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run to verify pass** — `pnpm turbo run lint typecheck test --filter=@nibras/web --filter=@nibras/i18n --concurrency=2 && pnpm --filter @nibras/web build && pnpm --filter @nibras/web budget` — Expected: PASS; the lesson route's first-load JS excludes hls.js/pdfjs (dynamic chunks). Manual: play the seeded MP4 and open the seeded PDF (T17 seeds them; here use an uploaded one) — watermark visible, moves, survives fullscreen; `headers.spec.ts` still green.
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): lazy video player (hls.js/native) and PDF viewer (pdf.js) with silent grant renewal, moving watermark overlay, MEDIA_ORIGINS in the CSP"
```

---

### Task 17: E2E, a11y, seed — teacher and student journeys in fr/ar, upload resume, watermark, locks

Depends on T16.

**Files:**

- Create: `apps/web/e2e/courses.spec.ts`, `e2e/uploads.spec.ts`, `e2e/learn.spec.ts`, `e2e/watermark.spec.ts`, `e2e/helpers/media.ts` (`seedCourse(ownerCtx, wid, { lessons })` through the API: create course, module, upload the PDF fixture via the multipart flow with Playwright's `request` (`fetch` for the `PUT`s), wait for `READY` by polling, TEXT lesson, publish, enroll; `uploadFixture(ctx, wid, kind, file)`), `e2e/fixtures/{sample.pdf (2 pages, < 100 kB), sample.mp4 (the providers' fixture written to disk by a script, ~200 kB), sample.png, not-a-pdf.bin}`
- Modify: `apps/web/e2e/a11y.spec.ts` (audits: `courses` list, course editor (structure), `my-courses`, `course-outline`, `lesson-pdf`, `lesson-text` — fr/ar, desktop and `mobile-ar`), `apps/web/e2e/helpers/seed.ts` (`seedStudentInWorkspace` already exists from SP2; reuse), `apps/web/playwright.config.ts` (web server env `MEDIA_ORIGINS`), `packages/db/prisma/seed.ts` (demo course « Mathématiques Niveau 1 » for Leila's workspace: two modules, a TEXT lesson, a PDF lesson pointing to a `READY` asset whose object the seed uploads to MinIO through `S3StorageProvider` (skips with a warning when MinIO is unreachable), enrollments for Yassine and Noussa; idempotent)
- Test: the four specs + a11y, `pnpm db:seed` smoke

- [ ] **Step 1: Write the failing e2e specs**

```ts
// courses.spec.ts (chromium-fr, chromium-ar)
test('teacher: create → publish refused (blockers listed) → add module + text lesson → publish → assign a student → student sees it in Mes cours (AC-CRS-01, AC-ENR-01 UI)', …);
test('two tabs edit the same course: second save shows the conflict dialog; « Écraser » wins (AC-CRS-03 UI)', …);
test('keyboard reorder of 5 lessons persists 1..5 after reload (AC-CRS-04 UI)', …);
test('delete a published course offers « Archiver puis supprimer »; with an active enrollment the deletion is refused with a hint (AC-CRS-05 UI)', …);
// uploads.spec.ts
test('PDF upload resumes: abort the context route for S3 PUTs after 1 part, reload, pick the same file → « Reprendre l\'envoi » → READY; the first part is not re-sent (AC-MED-01 UI)', …); // page.route on the S3 origin counting PUT part numbers
test('a renamed .exe declared as PDF is refused with the detected type (AC-MED-04 UI); over-quota shows usage (AC-MED-07 UI, quota lowered through psql)', …);
// learn.spec.ts
test('student: locked module 2 shows « Terminez le module 1 (80 %) », opening its lesson is refused; completing module 1 unlocks (AC-ENR-03 UI)', …);
test('unpublish while the student is on the outline: the next navigation shows « Ce cours n\'est plus disponible » (AC-CRS-02 UI); PDF download hidden when not allowed (AC-MED-06 UI)', …);
// watermark.spec.ts (chromium-fr + mobile-ar)
test('video and PDF lessons show the watermark with the student email; page.clock fast-forward 31 s moves it; it stays in fullscreen and no control removes it (AC-MED-09)', …);
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nibras/web e2e --project=chromium-fr courses uploads learn watermark` — Expected: FAIL (new specs; pages exist, selectors not yet aligned) or at least one assertion failing before fixes.
- [ ] **Step 3: Implement** the helpers, fixtures, seed, a11y additions; fix any page defect the specs reveal in the owning component (with its unit test).
- [ ] **Step 4: Run to verify pass** — `pnpm --filter @nibras/web e2e && pnpm --filter @nibras/web build && E2E_PROD=1 pnpm --filter @nibras/web e2e && pnpm db:seed && pnpm --filter @nibras/db test` — Expected: PASS on every project (a11y: 0 serious/critical on the new pages in fr/ar/mobile-ar; screenshots under `test-results/screens`).
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test(web): e2e teacher and student course journeys, upload resume and signature refusal, locks, watermark, axe fr/ar; demo course in the seed"
```

---

### Task 18: Final sweep — runbook, spec status, OpenAPI drift, full verification, FIX-LATER

Depends on everything.

**Files:**

- Create: `docs/runbooks/courses-and-media.md` (one page: providers and env (`VIDEO_PROVIDER`, S3 public endpoint and CORS, Cloudflare keys and webhook URL `POST /api/v1/webhooks/media/cloudflare_stream`, key rotation), upload flows and resume semantics, media state machine with the jobs and timeouts, quota accounting, playback tokens and the 30/h window (where the warn log lands), watermark, locks and the progress subset SP4 extends, If-Match conventions, audit actions and events added, isolation fixtures added, troubleshooting (stuck `PROCESSING` → cleanup job / reconcile; `ETag` missing in the browser → bucket CORS; a webhook `401` → clock skew or secret; emptying a test bucket))
- Modify: `docs/runbooks/{auth-and-tenancy,local-dev,staging,frontend,students-and-invitations}.md` (links; the `courseIds` row of SP2's "what SP3 fills" table → done), `docs/superpowers/specs/2026-10-19-sp3-courses-media-design.md` (Status → Implemented; §13 notes and deviations from the commit bodies; owner questions still open with their defaults), `PRD.md` only if a decision contradicts it (expected: none — the S3 passthrough provider and polling are recorded in the spec as planner additions)

- [ ] **Step 1: Run everything** — `pnpm turbo run lint typecheck test build --concurrency=2 && pnpm format:check && pnpm --filter @nibras/db migrate:check && pnpm audit --prod --audit-level=high && pnpm --filter @nibras/api openapi:export && pnpm --filter @nibras/contracts generate && git diff --exit-code packages/contracts && pnpm --filter @nibras/web budget && pnpm --filter @nibras/web e2e && E2E_PROD=1 pnpm --filter @nibras/web e2e` — Expected: all PASS.
- [ ] **Step 2: Write the runbook and the spec notes**; list FIX-LATER items (candidates: the `/media` WebSocket namespace (Q2, SP7/SP8), in-app `COURSE_PUBLISHED` (Q3, SP7), course codes (Q4), video thumbnails on the S3 provider (client-side capture at upload), `Idempotency-Key` on enrollment batches, per-asset playback counters for the super-admin cost view (R5, SP10), revoked-access-mid-playback save loop (SP4)).
- [ ] **Step 3: Commit**

```bash
git add docs && git commit -m "docs: courses and media runbook, sp3 spec status and deviations; sp3 closed"
```

---

## Parallel groups

Not applicable while the disk constraint holds: execute **T0 → T18 in order in the main checkout**. For review only, the dependency graph is: T0 → T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8; T9 after T7; T10 after T9; T11 after T10; T12 → T13 → T14 → T15 → T16 → T17 → T18. Should disk allow it later, `{T8}` can run beside `{T9, T10}` and `{T13}` beside `{T14}` (two implementers at most).

## Self-review notes (performed while writing)

- **Every DoD item has an owning task:** AC-CRS-01 → T5/T17; 02 → T5/T10/T17; 03 → T5/T11/T17; 04 → T6/T12/T17; 05 → T5/T11/T17; AC-MED-01 → T2/T7/T12/T17; 02 → T7/T8 (+ polling T12, Q2); 03 → T8; 04 → T7/T17; 05 → T7/T10/T16; 06 → T10/T16/T17; 07 → T7/T17; 08 → T7/T12; 09 → T16/T17; AC-ENR-01 → T9/T17; 02 → T9/T10; 03 → T10/T17; 05 → T9; upload-resume test → T2 (storage), T7 (API), T17 (UI); webhook-idempotence test → T7/T8. Spec decisions D1–D17 are realised in T7/T12, T3, T3/T4, T16, T0/T6/T13, T10, T1/T10, T5, T1/T6, T2/T4, T7, T12, T7, T9, (D15 none), T7/T8, T7/T8 respectively.
- **Consumed names checked against SP1.6 (branch, 2026-10-19) and the SP2 plan/spec on `main`:** `WorkspaceContextGuard` branches, `currentGrant`/`assertOwn`, `memberCtx` + `ownScope`, `lockWorkspace`/`readSettings`, `validationFailed`, `AuditService` union + `NEVER_AUDITED_KEYS`, `QueueService`/`FakeQueueService`, `hitWindow`/`rateLimited`, `ProvidersModule` factory pattern, `env.ts` transform-then-refine shape, `configureApp` (no body-parser change needed: `rawBody: true` is a factory option set in `main.ts` and the test helper), `createTestApp` fields, factories, `listRoutes`, isolation tables (SP1.6 T6 names), SP2 events (`InvitationAcceptedEvent`, `MembershipActivatedEvent`), SP2's `students.service.ts` contract placeholders (`courses: []`, `progressPercent: null`), SP2 schedulers/`writeSystemAudit`, `applyTestEnv`, `compose-staging.test.ts` assertion on `api`/`S3_*` (relaxed in T4), `buildCsp`/`proxy.ts`, `first-load-js.mjs`, Playwright config and projects, `OnboardingChecklist` items, `WorkspaceTabs`, `buildNavModel` comments reserving « Cours (SP3) ».
- **Known tensions:** (1) deferrable unique constraints vs `migrate:check` — T1 documents the two-phase fallback and T6 honours whichever landed; (2) real MinIO in three test suites makes `pnpm test` depend on Docker locally (already true for Postgres/Redis) and adds a CI step; the `windows-check` job skips the S3 suite through the env; (3) `rawBody: true` buffers every request body once more (bounded by the JSON limit) — accepted for one webhook route; (4) the student `/me` routes sit outside the generic isolation suite — T10 carries explicit cross-workspace cases, and the runbook says so; (5) Cloudflare code paths cannot run against the service in CI — unit vectors + `FakeVideoProvider` in the API/worker suites; the first staging run with `VIDEO_PROVIDER=cloudflare_stream` is the real test (runbook checklist); (6) `pdf-lib` loads the whole PDF in the worker (≤ 50 MiB) — acceptable at MVP volumes; (7) the lesson page relies on dynamic imports to stay under budget — the CI budget step enforces it.
- **Proportion:** 19 tasks (T0–T18), each one implementer; no task touches more than two apps except T4 (api + worker + infra, by nature of env wiring) and T9 (api + worker, by nature of a queued notification).
