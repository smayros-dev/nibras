# SP2 — Students & Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use **superpowers:subagent-driven-development** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Model policy (owner decision, overrides the skill's default tiers):** every implementer, task reviewer, re-reviewer and fixer subagent runs on **Opus** (`model: "opus"`). Changes to this plan, the spec or the architecture go back to **Fable** (`model: "fable"`). Always pass the model explicitly when dispatching.
>
> **Prerequisite:** `main` with SP1.6 merged (`sp1.6/security-hardening`). Branch `sp2/students-invitations` from that `main`. This plan consumes SP0/SP1/SP1.5/SP1.6 interfaces exactly as they exist there:
>
> - `@nibras/db`: `TENANT_MODELS` / `NULLABLE_TENANT_MODELS` (`src/tenancy.ts`), `tenantDb(wid)`, `withTenantTx(wid, fn)`, `crossTenantDb()` (requires a top-level `where.userId` or `where.id` equality — `hasUserOrIdFilter`, `src/tenant.ts:346`), `systemPrisma()`, `resetDatabase`, `uuidv7`; hand-written SQL convention (`prisma/migrations/20261011094217_identity_tenancy_constraints`, RLS pair + policy in `20261011095737_rls_and_audit_privileges`); `Membership`, `Consent` (partial unique `consent_guardian_parental_active_key`, check `consent_workspace_scope_check`), `VerificationToken`, `TeacherStudentAssignment` models.
> - `apps/api`: `ApiError(status, code, message, details?)`; guards in `AppModule` order RateLimit → `JwtAuthGuard` (`isPublicRequest`, loads `store.user`) → `AccountGatesGuard` → `SuperAdminGuard` → `WorkspaceContextGuard` (`isWorkspaceRoute`, `403 MEMBERSHIP_INACTIVE` for every non-ACTIVE status) → `PermissionGuard` → `TeacherVerifiedGuard`; decorators `@Public()`, `@PublicWithChallenge()`, `@AllowUnverified()`, `@CurrentUser()`, `@RequirePermission(p)`, `@RequireVerifiedTeacher()`, `@CrossTenant()`; `currentGrant(p)`, `assertOwn`, `permissionDenied()` (`src/tenancy/permissions.ts`); `MembershipService.addMember(input, tx?)` → `AddedMember { membership, audit }` (`src/members/membership.service.ts`); `MembersService.ownScope` (private — made protected/exported in T8), `memberCtx(wid)`, `MemberCtx`; `MembershipRemovedEvent` / `MEMBERSHIP_REMOVED` (`src/members/events.ts`); `AuditService.log({ action, entityType, entityId?, workspaceId?, before?, after? })` with the closed `AuditAction` union and `NEVER_AUDITED_KEYS`; `QueueService.add(queue, name, data, opts?)` + `FakeQueueService.jobs`; `EmailVerificationService.newToken(userId)` / `.send(user, raw)` / `verifyEmailLink`; `generateToken()` / `hashToken()` (`src/auth/crypto/tokens.ts`); `hitWindow(redis, key, windowS)` / `rateLimited(retryAfterS, msg)` (`src/auth/rate-window.ts`); `SessionService.createSession(user, { ip, userAgent, remember })` + `setAuthCookies(res, tokens)` (`src/auth/cookies.ts`); `RegisterService.registerTeacher` (the user + consents + token transaction to mirror); `consentMeta()` (`src/me/consent.service.ts`); `MeService.workspaces(userId)`; `lockWorkspace(tx, wid)` (`src/workspaces/workspace-settings.service.ts`), `validationFailed(path, msg)` (`src/workspaces/workspaces.service.ts`); `configureApp(app)` (`src/app.setup.ts`); `env.WEB_ORIGIN`; test helpers `createTestApp()` → `{ app, http, logs, db, email, sms, queue, pwned, reset }`, `loginAs`, `as`, `createUser`, `createOrganization`, `createPersonalWorkspace`, `addMember`, `assign`, `grantConsents`, `DEFAULT_PASSWORD`; isolation suite `test/isolation/{tenant-routes.e2e-spec.ts,fixtures.ts,exemptions.ts,admin-routes.e2e-spec.ts}` with `FOREIGN_PARAMS`, `FOREIGN_QUERIES`, `FOREIGN_BODIES`, `BODYLESS_WRITE_ROUTES` (SP1.6 T6); `listRoutes(app)` (`src/openapi/export.ts`).
> - `apps/worker`: `WorkerModule.register(env, logger)`, `ProcessorRegistry.registerProcessor(queue, jobName, handler)` / `dispatch`, `QueueRegistry.queues` (BullMQ `Queue` per name, bullmq `5.81.5` → `upsertJobScheduler` available), `WORKER_DB` (BYPASSRLS `PrismaClient`), `EMAIL_PROVIDER`, `WORKER_ENV` (`WEB_ORIGIN`), `WORKER_LOGGER`; `AbuseProcessor` pattern (`sentTo` progress, `minorSafetyReminder`), `apps/worker/test/abuse.e2e-spec.ts` pattern (`Test.createTestingModule({ imports: [WorkerModule.register(...)] }).overrideProvider(EMAIL_PROVIDER).useValue(new InMemoryEmailProvider())`, fake `Job`), `test/redis.ts` `obliterateAllQueues()`.
> - `@nibras/contracts`: `ERROR_CODES`, `QUEUES`, `DEFAULT_JOB_OPTIONS`, `CONSENT_VERSIONS`, `CurrentConsentTypes`, `REQUIRED_CONSENTS`, `BirthDateSchema`, `TimezoneSchema`, `LocaleSchema`, `RegisterTeacherSchema` (`kind: 'TEACHER'`), `MeUserSchema`, `MyWorkspaceSchema`, `MembersQuerySchema` / `MemberSummarySchema` (pagination shape `{ items, nextCursor }`), `MEMBERSHIP_ROLES`, `MEMBERSHIP_STATUSES`, `grantFor`, `PERMISSIONS`, `REDACT_KEYS`; the zod-free `src/web.ts` entry; generated `src/generated/api.d.ts` + `openapi/openapi.json` (`pnpm --filter @nibras/api openapi:export && pnpm --filter @nibras/contracts generate`; CI fails on drift).
> - `@nibras/providers`: `EMAIL_TEMPLATE_KEYS`, `EmailParamsByKey`, `renderEmail`, `layout`, `InMemoryEmailProvider` (`sent`, `last(to?)`, `findByTemplate(key, to?)`, `failFor(to)` — added by SP1.6 T7 if it was missing; if it is still absent on `main`, T3 adds it with a unit test), `extractFirstLink`; templates test iterating `EMAIL_TEMPLATE_KEYS × LOCALES` with `SAMPLE_PARAMS`.
> - `@nibras/i18n`: `messages/{fr,ar,en}.json` with the sync test (every key in the three catalogues) and the unused-key guard (`src/unused-keys.test.ts` scans `apps/web/src` and `packages/ui/src`); `formatDate`, `formatNumber`.
> - `apps/web`: `api` / `serverApi()` / `asApiResult` (`src/lib/api.ts`), `useAbortableQuery` (`src/lib/paged-fetch.ts`), `useSubmit`, `useToast`, `apiErrorMessage`, `issuesToFieldErrors`, `useTimezones`, `sanitizeNext`, `getSession()` / `getSessionResult()`, `buildNavModel` (`src/lib/navigation.ts`), `WorkspaceTabs`, `MembersPanel`, `OnboardingChecklist` (`inviteStudents` item `live: false`), `AuthCard`, `StatusPage`, `ReportAbuseButton`, `ConsentGate`; `@nibras/ui` components (`Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `Field`, `Badge`, `Alert`, `Card`, `Table`, `Dialog`, `AlertDialog`, `Sheet`, `DropdownMenu`, `Tabs`, `EmptyState`, `PageHeader`, `SkeletonTable`, `Spinner`, `useSubmit`); e2e helpers `seedUser`, `addOrgMember` (psql insert), `uiLogin`, `apiLogin`, `postRegister`, `waitForEmail`, `extractLink`, `t(locale, key)`, `toast()`, `appUrl`, projects `chromium-fr`, `chromium-ar`, `mobile-fr`, `mobile-ar` (`playwright.config.ts`), `a11y.spec.ts` `audit(page, testInfo, name)` pattern.
>
> **Execution notes (owner rulings carried from SP0/SP1/SP1.5/SP1.6, plus this plan's):**
>
> - **Disk:** the dev machine has ~1.8 GB free on `C:` (SP1.6 spec Q5). Tasks run **serially in the main checkout**: no worktrees, no second `node_modules`, one implementer at a time. The dependency notes on each task exist for review, not for parallel execution.
> - Every turbo invocation uses `--concurrency=2`. Single specs run with `pnpm --filter <pkg> exec vitest run <path>`.
> - **DB workflow (T1 only):** `pnpm --filter @nibras/db migrate:dev -- --name students_invitations --create-only` → append the hand-written SQL → `pnpm db:migrate` → `pnpm db:migrate:test` → `pnpm --filter @nibras/db migrate:check`. Never call `prisma migrate dev` directly.
> - **Turbo strict env:** this plan adds no env variable (links use `WEB_ORIGIN`, already listed). If a task must add one, it goes to `turbo.json`, `.github/workflows/ci.yml` `env` and `.env.example` in the same commit.
> - **Dependencies pinned exactly** when added: `csv-parse@6.1.0` (api + worker; if `pnpm view csv-parse version` shows a newer patch, pin it and note it in the commit body). No other runtime dependency is added.
> - i18n: every new key is added to `fr`, `ar`, `en` in the same commit; `pnpm --filter @nibras/i18n test` is part of the verification of any task touching `apps/web`, `packages/providers` or `packages/i18n`.
> - OpenAPI: any task that adds or changes a route regenerates `packages/contracts/openapi/openapi.json` + `src/generated/api.d.ts` in the same commit (`git diff --exit-code packages/contracts` after regeneration must be clean at the end of the task).
> - Secret naming rule (SP1): one-time codes are `otpCode` / `verificationCode` / `recoveryCode`; opaque link tokens are `token` in URLs and bodies (already redacted by `REDACT_KEYS`'s `*token*` rule); never put a raw token in a job payload, an audit row or a log line.

**Goal:** A verified teacher (or organisation admin) can invite students by email, by group code and by CSV import, invite teachers and admins into an organisation, see and manage the students of his workspace (list, pending tab, profile skeleton, approval queue, removal), while minors are blocked behind a per-workspace parental consent that a guardian grants, refuses or revokes from a signed public page without an account, with a 14-day expiry job that suspends but never purges, every email in FR/AR/EN naming the workspace and the teacher, every mutation audited, and every new tenant table behind the Prisma extension and RLS.

**Architecture:** `packages/db` gains `Invitation`, `InviteLink`, `GuardianLink`, `InvitationImport` (🏢, RLS) and a `CROSS_TENANT_LOOKUP_KEYS` rule so public token routes can resolve their workspace. `packages/contracts` gains the zod schemas, the error codes, the shared opaque-token helpers and the link builders. `packages/providers` gains 13 email templates. `apps/api` gains modules `invitations` (tenant CRUD + public accept), `invite-links` (CRUD + public join + approve/reject), `guardian` (public consent / guardian page, `/me` resend), `students` (list / profile / patch / resend), `imports` (CSV preview + job handoff), an `@OptionalAuth()` decorator, the `GUARDIAN_CONSENT_REQUIRED` gate and a `TokenAttemptLimiter`. `apps/worker` gains the CSV import processor, the two daily expiry processors with BullMQ job schedulers and a system-audit helper. `apps/web` gains the `(public)` route group (invite, join, guardian-consent, guardian), the students pages, the staff-invitation dialog on members, the CSV import dialog, the student waiting panel and the nav entries.

**Tech Stack additions (pin exactly):** `csv-parse@6.1.0` (api and worker). Everything else is already in the lockfile.

**Spec:** `docs/superpowers/specs/2026-10-18-sp2-students-invitations-design.md` → `PRD.md` v2.1 §4.1 (D-O5, D-O6, D-O7), §4.2 (D-P3, D-P18), §6, §7, §8.1.1, §8.1.4, §8.2.2, §8.3, §8.11.1, §9.1, §9.5, §10.3, §10.4, §11.1, §11.2, §12.1, §13.5, §15.3, §15.16 (AC-SAFE-06), §18 sub-project **2**.

## Global Constraints

Everything in SP0/SP1/SP1.5/SP1.6's Global Constraints still applies. In addition:

- **Definition of done (sub-project):** AC-INV-01…13 and AC-SAFE-06 automated (API e2e + Playwright where the AC is UI-facing); `pnpm turbo run lint typecheck test build --concurrency=2` green; `pnpm format:check` green; `pnpm --filter @nibras/db migrate:check` green; `pnpm --filter @nibras/web e2e` green locally and in CI (`E2E_PROD=1`); `pnpm audit --prod --audit-level=high` exit 0; OpenAPI drift check green; axe serious/critical = 0 on every new page in `chromium-fr`, `chromium-ar`, `mobile-ar`; runbook `docs/runbooks/students-and-invitations.md` written.
- Owner-locked rules (PRD §22) this plan must not reinterpret: D-O5 (consent per workspace, revocation suspends that membership only, no automatic purge), D-O6 (verified teacher before inviting), D-O7 (no personal workspace for an invited teacher), D-P3 (minor = < 18 everywhere), D-P18 (email invitations bound to the address; codes not bound, optional approval), the §7 matrix rows « Étudiants ».
- **Stable identifiers introduced here** (spelled identically across tasks): error codes `INVITATION_PENDING`, `INVITATION_EXPIRED`, `INVITATION_REVOKED`, `INVITATION_ALREADY_ACCEPTED`, `INVITATION_EMAIL_MISMATCH`, `INVITATION_ROLE_NOT_ALLOWED`, `BIRTH_DATE_REQUIRED`, `GUARDIAN_EMAIL_REQUIRED`, `GUARDIAN_EMAIL_INVALID`, `GUARDIAN_CONSENT_REQUIRED`, `CONSENT_LINK_EXPIRED`, `CONSENT_ALREADY_DECIDED`, `GUARDIAN_LINK_INACTIVE`, `INVITE_LINK_EXHAUSTED`, `INVITE_LINK_EXPIRED`, `INVITE_LINK_DISABLED`, `MEMBERSHIP_NOT_PENDING`, `IMPORT_TOO_LARGE`, `IMPORT_NO_VALID_ROWS`, `IMPORT_IN_PROGRESS`; constants `INVITATION_TTL_MS = 7 d`, `INVITATION_RESEND_WINDOW_S = 600`, `GUARDIAN_CONSENT_TTL_MS = 14 d`, `GUARDIAN_CONSENT_RESEND_WINDOW_S = 600`, `GUARDIAN_CONSENT_VERSION = 'guardian-2026-10'`, `MINOR_AGE_THRESHOLD = 18`, `INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'`, `INVITE_CODE_LENGTH = 8`, `INVITE_LINK_DEFAULT_MAX_USES = 50`, `INVITE_LINK_DEFAULT_TTL_DAYS = 30`, `IMPORT_MAX_ROWS = 500`, `IMPORT_MAX_BYTES = 1_048_576`, `TOKEN_ATTEMPTS_PER_MIN = 10`; jobs `INVITATIONS_IMPORT_JOB = 'invitations.import_csv'`, `importJobId(id) = 'import:{id}'`, `GUARDIAN_CONSENT_EXPIRE_JOB = 'guardian_consent.expire'`, `INVITATION_EXPIRE_JOB = 'invitation.expire'`, scheduler ids `guardian-consent-expire`, `invitation-expire`, `DAILY_SCHEDULER_PATTERN = '0 3 * * *'`; decorator `@OptionalAuth()` (`OPTIONAL_AUTH_KEY = 'auth:optional'`); `CROSS_TENANT_LOOKUP_KEYS`; events `INVITATION_ACCEPTED`, `MEMBERSHIP_ACTIVATED`, `MEMBERSHIP_DEACTIVATED`; functions `isMinor`, `maskEmail`, `generateOpaqueToken`, `hashOpaqueToken`, `invitationLink`, `joinLink`, `guardianConsentLink`, `guardianPageLink`, `generateInviteCode`, `writeSystemAudit`, `TokenAttemptLimiter`.
- **Permissions** (no new `PERMISSIONS` entries): STUDENT invitations, invite links, approve/reject, imports → `student.invite`; TEACHER/ADMIN invitations → additionally `currentGrant('workspace.staff.manage') === 'all'` and `workspace.type === 'ORGANIZATION'`; students read → `student.read`; student patch / resend consent → `student.update`; removal → SP1's `DELETE …/members/{uid}`. Every route that sends an invitation or consent email is `@RequireVerifiedTeacher()`.
- **Scope `own`** (organisation TEACHER): invitations and invite links he created; students assigned to him or invited by him (`MembersService.ownScope`); approve/reject only on members whose `invitedByUserId` is him.
- **Status derivation:** a stored `PENDING` invitation past `expiresAt` is served as `EXPIRED` and refused by `accept` as `INVITATION_EXPIRED`; the daily job flips the stored value. An `InviteLink` past `expiresAt` is served as `EXPIRED`; `usesCount >= maxUses` is stored as `EXHAUSTED` at the moment it happens.
- **Minor invariant:** a `STUDENT` membership may become `ACTIVE` only when `!isMinor(birthDate)` or an unrevoked `GUARDIAN_PARENTAL` consent for that workspace exists — enforced in `accept`, `approve` and `grant`, and asserted by `expectMinorInvariant(db, wid)` (T3 helper) in every spec that activates a student.
- **Error shape:** services throw `ApiError` with the codes above; a public route that cannot find a token answers `410 TOKEN_INVALID` (unknown and replaced tokens are indistinguishable); an unknown invite code answers `404 NOT_FOUND`.
- UI copy: French strings quoted from the PRD are verbatim (« Mohamed vous invite à rejoindre… », « Cette invitation est destinée à … », « Invitation expirée — demandez à votre professeur de la renvoyer », « J'autorise {student} à utiliser l'espace de {teacher} », « Votre professeur n'a pas encore … » is SP6); AR/EN are the builder's translations.

## Review Focus

Six failure modes the spec implies but no acceptance criterion exercises directly; each has its test in the owning task.

1. **Token replay across resend and across workspaces** — after a resend the previous invitation link must answer `410 TOKEN_INVALID`, and an invitation token of workspace A must never resolve inside workspace B's context (the `crossTenantDb` lookup rule must accept only the unique secret columns, never `email`). → T1, T4, T5.
2. **Minor without consent reaching `ACTIVE`** — an adult invitation whose `JOIN` body carries a birth date making the user a minor, a code with approval for a minor, and a guardian `grant` on a link whose membership was `REMOVED` meanwhile must all leave the membership non-ACTIVE (`expectMinorInvariant`). → T5, T6, T7.
3. **Concurrency on shared counters** — two simultaneous `POST /join/{code}/accept` on a link with one use left: exactly one `201`, one `410 INVITE_LINK_EXHAUSTED`, `usesCount = maxUses`; two simultaneous accepts of one invitation: one `201`, one `410 INVITATION_ALREADY_ACCEPTED`. → T5, T6.
4. **Guardian link scoping** — the guardian page token of (student, workspace A) shows nothing of workspace B even when the same guardian email consented in B; revoking in A leaves B `ACTIVE` (AC-INV-11 covers the membership; this covers the page). → T7.
5. **Import idempotence under retry** — a job interrupted after row 40 of 95 (the test rejects the database write of row 41 once, through a spy on the worker client) must, on the second run, create and email rows 41–95 only; `createdCount` ends at 95 and no address receives two emails. An email failure on one row (`failFor`) must not stop the job: that row is `FAILED`, its invitation exists and can be resent, the others proceed. → T10.
6. **RTL and translation on public pages** — the AR invite, join, consent and guardian pages render `dir="rtl"`, the consent email in AR carries an Arabic subject and `dir="rtl"`, and no raw key appears (`RAW_KEY` regex) on any of them. → T2, T11, T12.

---

## File Structure

```
packages/contracts/src/{opaque-token,invite-constants,invitations,invite-links,guardian,students,imports}.ts (+ .test.ts)   (T0)
packages/contracts/src/{error-codes,queues,index,web}.ts                                                                    (T0)
packages/db/prisma/schema.prisma + migrations/<ts>_students_invitations/migration.sql  src/{tenancy,tenant}.ts  src/{schema,tenant}.test.ts   (T1)
packages/providers/src/email/{types.ts,templates.test.ts}  packages/i18n/messages/{fr,ar,en}.json (emails.*)                 (T2)
apps/api/src/auth/decorators/optional-auth.ts  src/auth/guards/{jwt-auth,account-gates}.guard.ts  src/tenancy/workspace-context.guard.ts   (T3)
apps/api/src/common/token-attempt-limiter.ts  src/members/events.ts  src/audit/audit.service.ts  src/app.setup.ts  src/auth/crypto/tokens.ts   (T3)
apps/api/test/helpers/{factories,invariants}.ts  test/isolation/{tenant-routes.e2e-spec.ts,fixtures.ts}  test/tenancy/workspace-context.e2e-spec.ts   (T3, T8)
apps/api/src/invitations/{invitations.module,invitations.controller,invitations.service,invitation-mailer.service,public-invitations.controller,accept.service,dto}.ts   (T4, T5)
apps/api/src/invite-links/{invite-links.module,invite-links.controller,invite-links.service,join.controller,join.service,approval.controller,approval.service,code,dto}.ts   (T6)
apps/api/src/guardian/{guardian.module,guardian.controller,guardian.service,guardian-mailer.service,me-guardian.controller,dto}.ts   (T7)
apps/api/src/students/{students.module,students.controller,students.service,dto}.ts                                        (T8)
apps/api/src/imports/{imports.module,imports.controller,imports.service,csv.ts,dto}.ts                                      (T10)
apps/api/test/{invitations,invite-links,guardian,students,imports}/*.e2e-spec.ts                                            (T4–T10)
apps/worker/src/{system-audit,schedulers}.ts  src/processors/{expiry,imports}.processor.ts  src/worker.module.ts  test/{expiry,imports,schedulers}.e2e-spec.ts   (T9, T10)
apps/web/src/app/[locale]/(public)/{layout.tsx,invite/[token]/page.tsx,join/[code]/page.tsx,guardian-consent/[token]/page.tsx,guardian/[token]/page.tsx}   (T11, T12)
apps/web/src/app/[locale]/legal/minors/page.tsx                                                                             (T12)
apps/web/src/components/{invitation-accept-form,join-form,membership-pending-panel,guardian-consent-form,guardian-panel}.tsx (+ tests)   (T11, T12)
apps/web/src/app/[locale]/(app)/app/w/[wid]/students/{page,loading}.tsx  students/[uid]/{page,loading}.tsx  workspace-tabs.tsx   (T13, T14)
apps/web/src/components/{students-panel,invite-student-dialog,invite-link-card,invitations-list,student-profile-panel,invite-staff-dialog,csv-import-dialog}.tsx (+ tests)   (T13–T15)
apps/web/src/lib/navigation.ts  src/components/{onboarding-checklist,members-panel}.tsx  src/app/[locale]/(app)/app/(home)/page.tsx   (T13, T14)
apps/web/e2e/{invitations,guardian,students,imports}.spec.ts  e2e/a11y.spec.ts  e2e/helpers/seed.ts                           (T11–T16)
docs/runbooks/students-and-invitations.md  docs/runbooks/auth-and-tenancy.md  docs/superpowers/specs/2026-10-18-sp2-students-invitations-design.md   (T16)
```

---

### Task 0: Contracts — error codes, opaque tokens, link builders, zod schemas, job constants

No dependency. Everything later imports from here.

**Files:**

- Create: `packages/contracts/src/opaque-token.ts` (+ `.test.ts`), `src/invite-constants.ts` (+ `.test.ts`), `src/invitations.ts`, `src/invite-links.ts`, `src/guardian.ts`, `src/students.ts`, `src/imports.ts`, `src/invitations.test.ts`, `src/guardian.test.ts`, `src/imports.test.ts`
- Modify: `src/error-codes.ts` (append the 20 codes of Global Constraints, in that order, under a `// SP2: students & invitations` comment), `src/queues.ts` (job constants), `src/index.ts` (export the seven new modules), `src/web.ts` (export `invite-constants` only — zod-free)

**Interfaces:**

- `opaque-token.ts` (`node:crypto`, server entry only): `generateOpaqueToken(): { raw: string; hash: string }` (32 random bytes → base64url, `hash = sha256(raw)` hex — identical to `apps/api/src/auth/crypto/tokens.ts` `generateToken`), `hashOpaqueToken(raw): string`, `OPAQUE_TOKEN_RAW_LENGTH = 43`.
- `invite-constants.ts` (zod-free): `INVITATION_STATUSES`, `INVITE_LINK_STATUSES`, `GUARDIAN_LINK_STATUSES` (`PENDING | ACTIVE | REFUSED | REVOKED`), `GUARDIAN_RELATIONSHIPS = ['PARENT', 'LEGAL_GUARDIAN', 'OTHER']`, `INVITABLE_ROLES = ['STUDENT', 'TEACHER', 'ADMIN']`, `IMPORT_STATUSES`, `IMPORT_ROW_OUTCOMES = ['OK', 'OK_COURSES_IGNORED', 'OK_GUARDIAN_AT_ACCEPT', 'INVALID_EMAIL', 'DUPLICATE_IN_FILE', 'ALREADY_MEMBER', 'ALREADY_INVITED', 'INVALID_BIRTH_DATE', 'INVALID_GUARDIAN_EMAIL', 'CREATED', 'FAILED']`, the numeric constants of Global Constraints, `INVITE_CODE_ALPHABET`, `INVITE_CODE_LENGTH`, `normaliseInviteCode(raw): string | null` (trim, upper-case, `null` unless 8 alphabet chars), `maskEmail(email): string` (`a***@example.com`: first char + `***` + `@domain`; a one-char local part → `*@domain`), `MINOR_AGE_THRESHOLD`, `isMinor(birthDate: string /* YYYY-MM-DD */, at = new Date()): boolean` (UTC calendar arithmetic: minor iff the 18th birthday is after `at`'s UTC date; 29 Feb births become adults on 1 March), link builders `invitationLink(origin, locale, raw)` = `${origin}/${locale}/invite/${raw}`, `joinLink(origin, locale, code)`, `guardianConsentLink(origin, locale, raw)` = `/guardian-consent/${raw}`, `guardianPageLink(origin, locale, raw)` = `/guardian/${raw}` (origin trailing slashes stripped).
- `invitations.ts` (zod): `CreateInvitationSchema` `{ email (trim, lower, email, ≤ 254), role: enum(INVITABLE_ROLES).default('STUDENT'), firstName?, lastName? (trim 1–80), guardianEmail? (same as email), birthDate?: BirthDateSchema, message?: trim ≤ 500, courseIds?: z.array(z.uuid()).max(50).default([]), teacherUserId?: z.uuid() }.strict()` + refine `guardianEmail !== email`; `UpdateInvitationSchema` `{ firstName?, lastName?, guardianEmail?: nullable, message?: nullable }.strict()`; `InvitationsQuerySchema` `{ status?, role?, q? (trim 1–100), cursor?: z.uuid(), limit 1–100 default 50 }`; `InvitationSummarySchema` `{ id, email, role, firstName, lastName, guardianEmail (nullable), status (derived), expiresAt, invitedByUserId, invitedByName, teacherUserId, courseIds, resentCount, lastSentAt, acceptedAt, revokedAt, createdAt }` (ISO strings); `InvitationsPageSchema` `{ items, nextCursor }` (keyset on `createdAt desc, id desc`; cursor = id); `InvitationPreviewSchema` `{ workspace { id, name, type }, inviter { firstName, lastName }, role, emailMasked, accountExists, viewer: enum(['ANONYMOUS','MATCH','MISMATCH']), requiresBirthDate, guardianEmailPrefilled, expiresAt, message }`; `AcceptInvitationSchema = z.discriminatedUnion('mode', [ z.object({ mode: 'REGISTER', firstName, lastName, password: z.string().min(12).max(256), locale: LocaleSchema, timezone: TimezoneSchema, birthDate?: BirthDateSchema, guardianEmail?: email, acceptTerms: z.literal(true), acceptPrivacy: z.literal(true) }).strict(), z.object({ mode: 'JOIN', birthDate?, guardianEmail? }).strict() ])`; `AcceptResultSchema` `{ user: MeUserSchema, workspace { id, name, type }, membershipStatus: enum(MEMBERSHIP_STATUSES), role }`.
- `invite-links.ts`: `CreateInviteLinkSchema` `{ label? (trim ≤ 80), requiresApproval?: boolean, maxUses?: int 1–1000, expiresAt?: z.iso.datetime() (≤ now + 365 d, refined in the service), courseIds?: uuid[] default [], teacherUserId?: uuid }.strict()`; `UpdateInviteLinkSchema` `{ label?, status?: enum(['ACTIVE','DISABLED']), maxUses?, expiresAt?: nullable, requiresApproval? }.strict()` (at least one key); `InviteLinkSchema` `{ id, code, label, requiresApproval, maxUses, usesCount, expiresAt, status (derived), createdByUserId, teacherUserId, courseIds, createdAt, url }` (`url` = `joinLink(WEB_ORIGIN, workspace.defaultLocale, code)`); `JoinPreviewSchema` `{ workspace { id, name, type }, teacher { firstName, lastName }, requiresApproval, viewer, accountRequired: boolean (anonymous) }`; `AcceptJoinSchema` = the `AcceptInvitationSchema` union where `REGISTER` additionally has `email` (trim, lower, email).
- `guardian.ts`: `GUARDIAN_CONSENT_VERSION`, `GuardianDecisionSchema` `{ decision: enum(['GRANT','REFUSE']), guardianFirstName, guardianLastName (trim 1–80), relationship: enum(GUARDIAN_RELATIONSHIPS), acceptNotice?: boolean }.strict()` + refine `decision === 'REFUSE' || acceptNotice === true` (issue on `acceptNotice`); `GuardianRegrantSchema` (same minus `decision`); `GuardianConsentPreviewSchema` `{ student { firstName, lastName }, workspace { name, type }, teacher { firstName, lastName }, expiresAt, version, noticeUrl, state: enum(['PENDING']) }`; `GuardianViewSchema` `{ student { firstName, lastName }, workspace { id, name, type }, teacher { firstName, lastName }, link { status, grantedAt, revokedAt, relationship }, sessions: z.array(z.unknown()) /* SP5 replaces with SessionSummary */ }`; `GuardianInfoSchema` `{ emailMasked, status, consentExpiresAt }` (used by `MyWorkspaceSchema.guardian`, nullable optional — additive change in `me.ts`).
- `students.ts`: `StudentsQuerySchema` `{ status?: enum(MEMBERSHIP_STATUSES), q?, cursor? (opaque, same encoding as members), limit }`; `StudentSummarySchema` `{ userId, firstName, lastName, email?, status, joinedAt, invitedByUserId, isMinor, guardian: GuardianInfo & { email? } | null, progressPercent: z.number().nullable(), attendanceRate: nullable, lastActivityAt: nullable, courses: z.array(z.unknown()) }`; `StudentsPageSchema`; `StudentProfileSchema` (the §4.6 shape of the design); `UpdateStudentSchema` `{ guardianEmail?: email }.strict()`.
- `imports.ts`: `ImportRequestSchema` `{ fileName: trim 1–255, content: z.string().max(IMPORT_MAX_BYTES) }.strict()`; `ImportQuerySchema` `{ dryRun: z.coerce.boolean().default(false) }`; `ImportRowSchema` `{ line: int, email, firstName, lastName, guardianEmail, birthDate, courseCodes: string[], outcome: enum(IMPORT_ROW_OUTCOMES), message? }`; `ImportPreviewSchema` `{ totalRows, validRows, rows }`; `ImportStatusSchema` `{ id, fileName, status, totalRows, validRows, processedRows, createdCount, failedCount, report: ImportRow[], error, startedAt, finishedAt, createdAt }`; `ImportAcceptedSchema` `{ importId }`.
- `queues.ts`: the job constants and `DAILY_SCHEDULER_PATTERN` of Global Constraints; `InvitationsImportJob = { importId: string; workspaceId: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/contracts/src/invite-constants.test.ts
it("isMinor: 18th birthday is the first adult day, 29 Feb handled", () => {
  const at = new Date("2026-10-18T12:00:00Z");
  expect(isMinor("2008-10-19", at)).toBe(true);
  expect(isMinor("2008-10-18", at)).toBe(false);
  expect(isMinor("2008-02-29", new Date("2026-02-28T23:59:59Z"))).toBe(true);
  expect(isMinor("2008-02-29", new Date("2026-03-01T00:00:00Z"))).toBe(false);
});
it("maskEmail keeps first char and domain; normaliseInviteCode upper-cases and rejects ambiguity", () => {
  expect(maskEmail("ahmed@example.com")).toBe("a***@example.com");
  expect(maskEmail("a@x.tn")).toBe("*@x.tn");
  expect(normaliseInviteCode(" abcd2345 ")).toBe("ABCD2345");
  expect(normaliseInviteCode("ABCD0OI1")).toBeNull();
  expect(normaliseInviteCode("ABC")).toBeNull();
});
it("link builders strip trailing slashes and prefix the locale", () => {
  expect(invitationLink("https://x/", "ar", "tok")).toBe(
    "https://x/ar/invite/tok",
  ); /* join, consent, guardian */
});
// opaque-token.test.ts: raw is 43 base64url chars, hash is 64 hex, hashOpaqueToken(raw) === hash, two calls differ
// invitations.test.ts: CreateInvitationSchema lower-cases the email, defaults role STUDENT and courseIds [], refuses guardianEmail === email and an unknown key; AcceptInvitationSchema REGISTER requires acceptTerms true; JOIN refuses a password
// guardian.test.ts: GRANT without acceptNotice → issue on acceptNotice; REFUSE without it passes
// imports.test.ts: content > IMPORT_MAX_BYTES refused; ImportQuerySchema coerces 'true'
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/contracts test` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the seven modules, the error codes, the queue constants and the two entry points; `pnpm turbo run build --filter=@nibras/contracts --concurrency=2`. Check that `apps/web`'s first-load budget does not change (`web.ts` only gains zod-free code; run `pnpm --filter @nibras/web build && pnpm --filter @nibras/web budget` once at the end of T15 — not here).
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/contracts --concurrency=2` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/contracts && git commit -m "feat(contracts): sp2 invitations, invite links, guardian consent, students and imports schemas; opaque tokens; link builders; error codes"
```

---

### Task 1: Prisma schema — `Invitation`, `InviteLink`, `GuardianLink`, `InvitationImport`, RLS, partial unique, cross-tenant lookup keys

Depends on T0 (enum names only). Includes the plan's single migration.

**Files:**

- Modify: `packages/db/prisma/schema.prisma`, `packages/db/src/tenancy.ts` (`TENANT_MODELS` + `['Invitation', 'InviteLink', 'GuardianLink', 'InvitationImport']`), `packages/db/src/tenant.ts` (`CROSS_TENANT_LOOKUP_KEYS` + `hasUserOrIdFilter` → `hasCrossTenantFilter(model, args)`), `packages/db/src/index.ts` (export `CROSS_TENANT_LOOKUP_KEYS`), `packages/db/src/schema.test.ts`, `packages/db/src/tenant.test.ts`
- Create: `packages/db/prisma/migrations/<ts>_students_invitations/migration.sql` (generated + hand-written section)

**Interfaces:**

- Models exactly as the design §3 (`@map` snake_case, `@@map("invitation")`, `("invite_link")`, `("guardian_link")`, `("invitation_import")`; enums `InvitationStatus`, `InviteLinkStatus`, `GuardianLinkStatus` (with `REFUSED`), `GuardianRelationship`, `ImportStatus`); relations: `Invitation.workspace`, `Invitation.invitedBy → User`, `InviteLink.workspace`, `InviteLink.createdBy → User`, `GuardianLink.workspace`, `GuardianLink.student → User`, `GuardianLink.consent → Consent?`, `InvitationImport.workspace`, `InvitationImport.createdBy → User`; `User` gains the reverse relations; `onDelete: Cascade` from workspace. Scalar lists (`courseIds`) get the SP1 `SET DEFAULT '{}' / SET NOT NULL` hand-written statements.
- Hand-written SQL (same comment banner as `identity_tenancy_constraints`): `CREATE UNIQUE INDEX "invitation_pending_per_email_key" ON "invitation"("workspace_id", "email") WHERE "status" = 'PENDING';` then, for each of the four tables, `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY; CREATE POLICY "tenant_isolation" …` copied verbatim from `20261011095737_rls_and_audit_privileges` (with the `NULLIF` form).
- `tenant.ts`: `export const CROSS_TENANT_LOOKUP_KEYS = { Invitation: ['tokenHash'], InviteLink: ['code'], GuardianLink: ['consentTokenHash', 'sessionsViewTokenHash'] } as const satisfies Partial<Record<TenantModel, readonly string[]>>`; `crossTenantDb()` accepts an operation on a tenant model when `where` carries a top-level equality on `userId`, `id`, or one of the model's lookup keys (a string value, not an object filter such as `{ contains }`); the error message of `CrossTenantFilterMissingError` lists the accepted keys for that model.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/src/schema.test.ts (+)
it('one PENDING invitation per (workspace, email); ACCEPTED/REVOKED rows do not collide', async () => { /* two PENDING → P2002 on invitation_pending_per_email_key; PENDING + REVOKED → ok; email case variants collide (citext) */ });
it('GuardianLink is unique per (student, workspace) and GuardianLinkStatus has REFUSED', ...);
it('InviteLink.code is unique; InvitationImport defaults (processedRows 0, status QUEUED)', ...);
// packages/db/src/tenant.test.ts (+)
it('RLS: app_user without context sees 0 rows of invitation, invite_link, guardian_link, invitation_import', ...);
it('tenantDb(A) refuses to create an invitation for B; guarded db throws TENANT_CONTEXT_MISSING on invitation.findFirst', ...);
it('crossTenantDb accepts a tokenHash / code / consentTokenHash lookup and refuses email or status', async () => {
  await expect(crossTenantDb().invitation.findFirst({ where: { tokenHash: 'h' } })).resolves.toBeNull();
  await expect(crossTenantDb().inviteLink.findFirst({ where: { code: 'ABCD2345' } })).resolves.toBeNull();
  await expect(crossTenantDb().invitation.findFirst({ where: { email: 'a@b.c' } })).rejects.toThrow(/tokenHash/);
  await expect(crossTenantDb().guardianLink.findMany({ where: { status: 'PENDING' } })).rejects.toThrow(/consentTokenHash/);
});
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/db test` — Expected: FAIL (`db.invitation` undefined).
- [ ] **Step 3: Implement** — models, `pnpm --filter @nibras/db migrate:dev -- --name students_invitations --create-only`, append the hand-written section, `pnpm db:migrate && pnpm db:migrate:test`, `tenancy.ts`, `tenant.ts`, `pnpm --filter @nibras/db generate`.
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/db --concurrency=2 && pnpm --filter @nibras/db migrate:check` — Expected: PASS; no drift.
- [ ] **Step 5: Commit**

```bash
git add packages/db && git commit -m "feat(db): invitation, invite link, guardian link and invitation import tables under rls; cross-tenant lookup by secret columns"
```

---

### Task 2: Email templates FR/AR/EN — invitations, guardian consent, join, imports

Depends on T0 (`GUARDIAN_RELATIONSHIPS` for params typing only). Parallel-safe with T1.

**Files:**

- Modify: `packages/providers/src/email/types.ts` (`EMAIL_TEMPLATE_KEYS` + 13 keys, `EmailParamsByKey` entries), `packages/providers/src/email/templates.test.ts` (`SAMPLE_PARAMS` for every new key + the two assertions below), `packages/i18n/messages/{fr,ar,en}.json` (`emails.invitation.*`, `emails.guardian.*`, `emails.join.*`, `emails.imports.*`)

**Interfaces:**

- Keys and params exactly as the design §6: `invitation.received_student` `{ firstName, inviterName, workspaceName, message, link, expiresAt }` (empty strings allowed for `firstName` / `message`: the ICU body uses `{firstName, select, other {…}}`-free plain sentences with a neutral greeting when empty — implement as two sentences selected by `{hasName, select, yes {Bonjour {firstName},} other {Bonjour,}}` with `hasName: 'yes' | 'no'` added to the params), `invitation.received_staff` `{ inviterName, workspaceName, role, link, expiresAt }` (`role` rendered through `{role, select, TEACHER {professeur} ADMIN {administrateur} other {membre}}`), `invitation.accepted` `{ firstName, memberName, workspaceName, link }`, `guardian.consent_requested` `{ studentName, workspaceName, teacherName, link, expiresAt }` (FR subject « {studentName} souhaite rejoindre l'espace de {teacherName} »), `guardian.consent_confirmation` `{ studentName, workspaceName, teacherName, link }` (body states the link gives access to the child's session list and must not be forwarded), `guardian.consent_granted` `{ firstName, studentName, workspaceName, link }`, `guardian.consent_granted_teacher` (same), `guardian.consent_refused` / `guardian.consent_revoked` / `guardian.consent_expired` `{ firstName, studentName, workspaceName, teacherName, recipientRole: 'STUDENT' | 'TEACHER', link }`, `join.approved` / `join.rejected` `{ firstName, workspaceName, teacherName, link }`, `imports.completed` `{ firstName, workspaceName, created: number, failed: number, link }`. `expiresAt` params are pre-formatted date strings (the caller formats with `formatDate` in the recipient's locale and time zone — AC-I18N-02).
- Every template body names `workspaceName` **and** the teacher (`inviterName` / `teacherName`) — asserted by the test.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/providers/src/email/templates.test.ts (+)
it("every SP2 template names the workspace and the teacher in every locale", () => {
  for (const key of SP2_KEYS)
    for (const locale of LOCALES) {
      const out = renderEmail(key, locale, SAMPLE_PARAMS[key]);
      expect(out.text).toContain(SAMPLE_PARAMS[key].workspaceName);
      expect(out.text).toContain(
        SAMPLE_PARAMS[key].teacherName ?? SAMPLE_PARAMS[key].inviterName,
      );
    }
});
it("guardian.consent_requested in ar is RTL with an Arabic subject and the link as CTA", () => {
  const out = renderEmail("guardian.consent_requested", "ar", {
    studentName: "أحمد",
    workspaceName: "فضاء محمد",
    teacherName: "محمد",
    link: "https://x/ar/guardian-consent/t",
    expiresAt: "١ نوفمبر",
  });
  expect(out.html).toContain('dir="rtl"');
  expect(out.subject).toMatch(/[؀-ۿ]/);
  expect(extractFirstLink(out.html, "/guardian-consent/")).toBe(
    "https://x/ar/guardian-consent/t",
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/providers test` — Expected: FAIL (unknown keys).
- [ ] **Step 3: Implement** the keys, params and the three catalogues (FR copy first, PRD wording for the consent subject; AR and EN translations; `emails.footer` unchanged).
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/providers --filter=@nibras/i18n --concurrency=2` — Expected: PASS (the i18n sync test enforces the three catalogues; the unused-key guard ignores `emails.*`).
- [ ] **Step 5: Commit**

```bash
git add packages/providers packages/i18n && git commit -m "feat(providers): invitation, guardian consent, join and import email templates in fr/ar/en naming workspace and teacher"
```

---

### Task 3: API infrastructure for SP2 — `@OptionalAuth()`, `GUARDIAN_CONSENT_REQUIRED` gate, `TokenAttemptLimiter`, events, audit actions, body limit, test helpers and isolation fixtures

Depends on T0, T1.

**Files:**

- Create: `apps/api/src/auth/decorators/optional-auth.ts`, `apps/api/src/common/token-attempt-limiter.ts` (+ `.spec.ts`), `apps/api/test/helpers/invariants.ts` (extend if SP1.6 created it: add `expectMinorInvariant`)
- Modify: `apps/api/src/auth/guards/jwt-auth.guard.ts`, `apps/api/src/auth/guards/account-gates.guard.ts`, `apps/api/src/tenancy/workspace-context.guard.ts`, `apps/api/src/members/events.ts`, `apps/api/src/audit/audit.service.ts` (`AuditAction` + the 20 actions of the design §5), `apps/api/src/app.setup.ts` (`app.useBodyParser('json', { limit: '1mb' })` — keeps the `413 PAYLOAD_TOO_LARGE` mapping), `apps/api/src/auth/crypto/tokens.ts` (re-export `generateOpaqueToken as generateToken`, `hashOpaqueToken as hashToken` from `@nibras/contracts`; keep `safeEqual`), `apps/api/test/helpers/factories.ts`, `apps/api/test/tenancy/workspace-context.e2e-spec.ts`, `apps/api/test/isolation/tenant-routes.e2e-spec.ts` (scenario (c): expected code by status), `apps/api/test/app-setup.e2e-spec.ts` (body limit)
- Test: `apps/api/src/common/token-attempt-limiter.spec.ts`, `apps/api/test/tenancy/workspace-context.e2e-spec.ts`, `apps/api/test/auth/optional-auth.e2e-spec.ts` (new, with a test-only controller mounted through `createTestApp({ controllers })`)

**Interfaces:**

- `@OptionalAuth()` (`OPTIONAL_AUTH_KEY`): `JwtAuthGuard` — on such a route, no cookie / invalid or expired token / revoked session → **pass without `store.user`** (never 401; the guard's existing "load user" branch runs when a valid access token is present, so `store.user` and `store.session` are set exactly as on a protected route); `AccountGatesGuard` — on such a route: no user → pass; user `status !== 'ACTIVE'` → `403 ACCOUNT_SUSPENDED` (AC-SAFE-04 still holds); the email-verified / consents / 2FA-setup gates are **skipped** (the invitation link itself proves the mailbox, and a pending consent is handled by the web after acceptance). `isOptionalAuthRequest(reflector, context)` exported next to `isPublicRequest`.
- `WorkspaceContextGuard`: statuses `PENDING_GUARDIAN_CONSENT`, `SUSPENDED_NO_CONSENT`, `SUSPENDED_CONSENT_REVOKED` → `403 GUARDIAN_CONSENT_REQUIRED` with `details: { status }`; `PENDING_APPROVAL` → `403 MEMBERSHIP_INACTIVE` (`details.status`) as before; doc comment updated. The SP1.6 isolation scenario (c) expects `GUARDIAN_CONSENT_REQUIRED` for the `SUSPENDED_CONSENT_REVOKED` student and `MEMBERSHIP_INACTIVE` for the `PENDING_APPROVAL` teacher.
- `TokenAttemptLimiter` (`@Injectable()`, `REDIS`): `async failed(scope: 'invite' | 'join' | 'guardian', ip: string): Promise<void>` → `hitWindow(redis, 'token-attempt:{scope}:{ip}', 60)`; `async assertAllowed(scope, ip): Promise<void>` → count `>= TOKEN_ATTEMPTS_PER_MIN` → `rateLimited(ttl, 'Too many attempts')`. Callers: `assertAllowed` before the lookup, `failed` after a miss (unknown / expired / replaced token).
- `events.ts`: `INVITATION_ACCEPTED = 'invitation.accepted'` + `class InvitationAcceptedEvent(workspaceId, invitationId, userId, role: MembershipRole)`; `MEMBERSHIP_ACTIVATED` + `class MembershipActivatedEvent(workspaceId, userId)`; `MEMBERSHIP_DEACTIVATED` + `class MembershipDeactivatedEvent(workspaceId, userId, status: 'SUSPENDED_NO_CONSENT' | 'SUSPENDED_CONSENT_REVOKED' | 'REJECTED', reason: 'CONSENT_REFUSED' | 'CONSENT_REVOKED' | 'CONSENT_EXPIRED' | 'REJECTED')` with the doc comment naming SP5 (future participations) and SP6 (room disconnect) as listeners.
- Factories: `createStudent({ workspace, status = 'ACTIVE', minor = false, birthDate?, invitedBy?, guardianEmail? })` → `{ user, membership, guardianLink? }` (a minor gets a `GuardianLink` `PENDING` with a raw `consentToken` returned for tests, or `ACTIVE` + consent row when `status === 'ACTIVE'`), `createInvitation({ workspace, invitedBy, email?, role = 'STUDENT', status = 'PENDING', expiresAt?, guardianEmail?, birthDate? })` → `{ invitation, token }` (raw), `createInviteLink({ workspace, createdBy, requiresApproval?, maxUses?, status? })` → `{ link, code }`, `createGuardianLink({ workspace, student, status, guardianEmail })` → `{ link, consentToken?, pageToken? }`, `createImport({ workspace, createdBy, rows })`.
- `invariants.ts`: `expectMinorInvariant(db, wid)`: for every `STUDENT` membership `ACTIVE` in `wid` whose user is a minor today, an unrevoked `GUARDIAN_PARENTAL` consent for `(userId, wid)` exists and the `GuardianLink` is `ACTIVE`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/auth/optional-auth.e2e-spec.ts (test controller: @OptionalAuth() @Get('optional-probe') → { userId: store.user?.id ?? null })
it('passes anonymously, loads a valid session, refuses a suspended account, ignores unverified email / pending consents', async () => {
  await http.get('/api/v1/optional-probe').expect(200, { userId: null });
  const u = await createUser({ emailVerified: false, consents: [] }); const s = await loginAs(ctx, u);
  await as(http, s.cookie).get('/api/v1/optional-probe').expect(200).expect(({ body }) => expect(body.userId).toBe(u.id));
  await as(http, 'nibras_access=garbage').get('/api/v1/optional-probe').expect(200, { userId: null });
  const suspended = await createUser({ status: 'SUSPENDED' }); await as(http, (await loginAs(ctx, suspended)).cookie).get('/api/v1/optional-probe').expect(403).expect(({ body }) => expect(body.code).toBe('ACCOUNT_SUSPENDED'));
});
// apps/api/test/tenancy/workspace-context.e2e-spec.ts (+)
it.each(['PENDING_GUARDIAN_CONSENT', 'SUSPENDED_NO_CONSENT', 'SUSPENDED_CONSENT_REVOKED'])('%s → 403 GUARDIAN_CONSENT_REQUIRED with details.status', ...);
it('PENDING_APPROVAL → 403 MEMBERSHIP_INACTIVE', ...);
// token-attempt-limiter.spec.ts: 10 failures in a minute → assertAllowed throws 429 with retryAfterS ≤ 60; another ip unaffected
// app-setup.e2e-spec.ts: a 900 kB JSON body is accepted by the parser (422 from zod, not 413); 1.2 MB → 413 PAYLOAD_TOO_LARGE
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/api exec vitest run test/auth/optional-auth test/tenancy/workspace-context src/common/token-attempt-limiter test/app-setup` — Expected: FAIL.
- [ ] **Step 3: Implement**; update `test/isolation/tenant-routes.e2e-spec.ts` scenario (c) and the runbook paragraph "Tenant isolation suite" (one sentence on the two codes).
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/api --concurrency=2` — Expected: PASS (whole API suite, including the isolation suite).
- [ ] **Step 5: Commit**

```bash
git add apps/api docs && git commit -m "feat(api): optional-auth routes, guardian-consent gate code, token attempt limiter, membership lifecycle events, sp2 audit actions and test factories"
```

---

### Task 4: Invitations API — create, list, get, update, resend, revoke (AC-INV-01, 04, 05, 06; staff invitations)

Depends on T2, T3.

**Files:**

- Create: `apps/api/src/invitations/{invitations.module,invitations.controller,invitations.service,invitation-mailer.service,dto}.ts`, `apps/api/test/invitations/invitations.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts` (import `InvitationsModule`), `apps/api/test/isolation/fixtures.ts` (`FOREIGN_PARAMS['invitations/:id']` → `p.b.invitation.id`; `FOREIGN_BODIES['POST /workspaces/:wid/invitations']` → `{ email, teacherUserId: p.b.teacher.id }`; `createTenantPair` creates one PENDING invitation per side), `packages/contracts/{openapi/openapi.json,src/generated/api.d.ts}`

**Interfaces:**

- `InvitationsController` (`@Controller('workspaces/:wid/invitations')`, `@RequirePermission('student.invite')` at class level): `GET` (`InvitationsQueryDto`) → `InvitationsPage`; `POST` (`@RequireVerifiedTeacher()`, `CreateInvitationDto`) → `201 InvitationSummary`; `GET ':id'`; `PATCH ':id'` (`UpdateInvitationDto`, PENDING/EXPIRED only, audit `invitation.updated`); `POST ':id/resend'` (`@RequireVerifiedTeacher()`) → `200 InvitationSummary`; `DELETE ':id'` → `204`. Routes `import/*` arrive in T10 and must be declared **above** `':id'` in this controller.
- `InvitationsService` (`memberCtx(wid)` for scope):
  - `create(ctx, input)`: role rule (`TEACHER`/`ADMIN` → `workspace.type === 'ORGANIZATION'` else `422 INVITATION_ROLE_NOT_ALLOWED`; `currentGrant('workspace.staff.manage') !== 'all'` → `403 PERMISSION_DENIED`); `teacherUserId` → caller must have scope `all`, target must be an ACTIVE `TEACHER` or `ADMIN/OWNER` with `canTeach` (else `422 VALIDATION_FAILED` on `teacherUserId`); when the caller is an organisation `TEACHER`, `teacherUserId = ctx.userId` implicitly; live membership for the email (any status but `REMOVED`/`REJECTED`, looked up through `tenantDb(wid).membership.findFirst({ where: { user: { email } } })`) → `409 ALREADY_MEMBER`; existing `PENDING` → `409 INVITATION_PENDING` (`details.invitationId`), also mapped from the `P2002` on `invitation_pending_per_email_key`; `generateOpaqueToken()`; row with `expiresAt = now + INVITATION_TTL_MS`, `lastSentAt = now`; audit `invitation.created { email, role, expiresAt, teacherUserId }`; `mailer.sendInvitation(invitation, raw, inviter, workspace)`; returns the summary (status derived).
  - `list(ctx, q)`: scope `own` → `invitedByUserId = ctx.userId`; staff rows (`role != STUDENT`) only when `currentGrant('workspace.staff.manage') === 'all'`; keyset on `(createdAt desc, id desc)` with cursor = last id (fetch the row's `createdAt` to build the `OR` condition); `q` matches email / first / last name (`insensitive`).
  - `resend(ctx, id)`: PENDING or EXPIRED (else `409 INVITATION_ALREADY_ACCEPTED` / `INVITATION_REVOKED`); `lastSentAt > now − 600 s` → `rateLimited(retryAfterS)`; new token, `expiresAt = now + 7 d`, `status PENDING`, `resentCount + 1`, `lastSentAt = now` — one conditional `updateMany` (`where: { id, status: { in: ['PENDING','EXPIRED'] } }`); audit `invitation.resent { resentCount, expiresAt }`; email again.
  - `revoke(ctx, id)`: PENDING/EXPIRED → `REVOKED`, `revokedAt`; audit `invitation.revoked`.
  - `derivedStatus(row, now)`: `PENDING && expiresAt <= now → 'EXPIRED'`.
- `InvitationMailerService`: `sendInvitation(invitation, raw, inviter: { firstName, lastName }, workspace: { name, defaultLocale })` → template by role, locale = `invitation`'s recipient locale (the existing account's `locale` if one exists, else the workspace `defaultLocale`), `link = invitationLink(env.WEB_ORIGIN, locale, raw)`, `expiresAt` formatted with `formatDate(expiresAt, locale, { dateStyle: 'long', timeZone: workspace.defaultTimezone })`; failures logged (`invitationId`, `err.type`), never thrown. Also `sendAccepted(invitation, member, inviter, workspace)` (used by T5).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/invitations/invitations.e2e-spec.ts
it('AC-INV-01: a verified teacher invites ahmed@example.com → PENDING, expires in 7 d, email with a unique /invite/ link, no token in the response or the audit row', async () => {
  const res = await as(http, teacherCookie).post(ws('/invitations')).send({ email: 'Ahmed@Example.com', firstName: 'Ahmed' }).expect(201);
  expect(res.body).toMatchObject({ email: 'ahmed@example.com', role: 'STUDENT', status: 'PENDING' }); expect(JSON.stringify(res.body)).not.toMatch(/token/i);
  const mail = ctx.email.findByTemplate('invitation.received_student', 'ahmed@example.com'); expect(extractFirstLink(mail!.html, '/invite/')).toMatch(/\/fr\/invite\/[A-Za-z0-9_-]{43}$/);
  const row = await db.invitation.findFirstOrThrow(); expect(+row.expiresAt - Date.now()).toBeGreaterThan(6.9 * 86400e3);
  const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'invitation.created' } }); expect(JSON.stringify(audit.after)).not.toContain(row.tokenHash);
});
it('AC-SAFE-01: an unverified teacher gets 403 TEACHER_NOT_VERIFIED', ...);
it('AC-INV-06: an ACTIVE member (student or teacher) → 409 ALREADY_MEMBER, no row, no email', ...);
it('a second PENDING invitation for the same email → 409 INVITATION_PENDING with the existing id; after revocation a new one is allowed', ...);
it('AC-INV-04: resend replaces the token, pushes expiresAt by 7 d, increments resentCount; a second resend within 10 min → 429 with retryAfterS', async () => {
  const { invitation, token } = await createInvitation({ workspace, invitedBy: teacher, expiresAt: new Date(Date.now() - 1000) });
  expect((await as(http, teacherCookie).get(ws('/invitations'))).body.items[0].status).toBe('EXPIRED');
  await db.invitation.update({ where: { id: invitation.id }, data: { lastSentAt: new Date(Date.now() - 11 * 60e3) } });
  const r = await as(http, teacherCookie).post(ws(`/invitations/${invitation.id}/resend`)).expect(200);
  expect(r.body).toMatchObject({ status: 'PENDING', resentCount: 1 }); expect((await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).tokenHash).not.toBe(hashOpaqueToken(token));
  await as(http, teacherCookie).post(ws(`/invitations/${invitation.id}/resend`)).expect(429).expect(({ body }) => expect(body.details.retryAfterS).toBeLessThanOrEqual(600));
});
it('AC-INV-05: revoke → REVOKED; resend of a revoked invitation → 409', ...);
it('staff invitations: TEACHER role needs an ORGANIZATION (422 on a personal workspace) and workspace.staff.manage (403 for an org TEACHER); an ADMIN invite sends invitation.received_staff', ...);
it('scope own: an org TEACHER lists only his invitations and never staff rows; the ADMIN lists all', ...);
it('teacherUserId: ADMIN may target an ACTIVE teacher; a student or a removed teacher → 422; a TEACHER inviter is the implicit teacher', ...);
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/api exec vitest run test/invitations` — Expected: FAIL (404 on the routes).
- [ ] **Step 3: Implement** module, service, mailer, DTOs; wire `AppModule`; add the isolation fixtures; regenerate OpenAPI.
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/api --concurrency=2 && pnpm --filter @nibras/api openapi:export && pnpm --filter @nibras/contracts generate && git diff --exit-code packages/contracts/openapi` — Expected: PASS; isolation suite green with the new fixtures.
- [ ] **Step 5: Commit**

```bash
git add apps/api packages/contracts && git commit -m "feat(api): workspace invitations — create, list, update, resend with cooldown, revoke; staff invitations for organisations (AC-INV-01, 04, 05, 06)"
```

---

### Task 5: Invitation acceptance (public) — preview, register or join, email binding, minors, staff (AC-INV-02, 03, 09, 13; AC-WS-08)

Depends on T4.

**Files:**

- Create: `apps/api/src/invitations/{public-invitations.controller,accept.service}.ts`, `apps/api/src/guardian/guardian-request.service.ts` (the shared "start a consent cycle" primitive, used by T5, T6, T7), `apps/api/test/invitations/accept.e2e-spec.ts`
- Modify: `apps/api/src/invitations/invitations.module.ts`, `apps/api/src/auth/register.service.ts` (extract `createAccountInTx(tx, { email, password hash, firstName, lastName, locale, timezone, birthDate?, emailVerifiedAt? }, meta)` from `registerTeacher` so both paths share the user + TERMS/PRIVACY consent creation), `packages/contracts/{openapi/openapi.json,src/generated/api.d.ts}`

**Interfaces:**

- `PublicInvitationsController` (`@Controller('invitations')`, `@OptionalAuth()`): `GET ':token'` → `InvitationPreview`; `POST ':token/accept'` (`AcceptInvitationDto`, `@Res({ passthrough })`) → `201 AcceptResult` (+ auth cookies on `REGISTER`).
- `AcceptService`:
  - `resolve(token, ip)`: `limiter.assertAllowed('invite', ip)`; `crossTenantDb().invitation.findFirst({ where: { tokenHash }, include: { workspace, invitedBy } })`; miss → `limiter.failed` + `410 TOKEN_INVALID`; `REVOKED` → `410 INVITATION_REVOKED`; `ACCEPTED` → `410 INVITATION_ALREADY_ACCEPTED`; expired → `410 INVITATION_EXPIRED`.
  - `preview(token, viewer?: AuthUser)`: `viewer` = `'ANONYMOUS'` / `'MATCH'` (same email, citext compare) / `'MISMATCH'`; `accountExists = !!db.user.findUnique({ where: { email } })`; `requiresBirthDate = role === 'STUDENT' && !(invitation.birthDate ?? existingUser?.birthDate)`; `guardianEmailPrefilled = !!invitation.guardianEmail`.
  - `accept(token, body, viewer?, meta)`: mismatch → `403 INVITATION_EMAIL_MISMATCH` (`details.emailMasked`); `REGISTER` while signed in → `422 VALIDATION_FAILED` on `mode` ("sign out first, or use JOIN"); `REGISTER` with an existing account → `409 EMAIL_TAKEN`; `JOIN` without a viewer → `401 UNAUTHENTICATED`. STUDENT: `birthDate = body.birthDate ?? invitation.birthDate ?? user.birthDate` else `422 BIRTH_DATE_REQUIRED`; `minor = isMinor(birthDate)`; `guardianEmail = body.guardianEmail ?? invitation.guardianEmail` — minor without it → `422 GUARDIAN_EMAIL_REQUIRED`; equal to the student's email → `422 GUARDIAN_EMAIL_INVALID`. Password policy for `REGISTER` (`PasswordPolicy.validate` → `422 PASSWORD_*`), hash outside the transaction. Then `withTenantTx(wid)`: `SELECT … FOR UPDATE` on the invitation, re-check status/expiry (`410` codes), `createAccountInTx` (with `emailVerifiedAt = now`, `birthDate`) or `tx.user.update` (`birthDate` when the account had none), `membership.addMember({ role, status: minor ? 'PENDING_GUARDIAN_CONSENT' : 'ACTIVE', invitedByUserId }, tx)`, assignment (`ORGANIZATION` and (`invitation.teacherUserId` or an inviter with a teaching role) → `teacherStudentAssignment.createMany({ skipDuplicates })`), minor → `guardianRequest.start(tx, { workspaceId, studentUserId, guardianEmail })` (returns the raw consent token), invitation → `ACCEPTED` (`acceptedByUserId`, `acceptedAt`, `tokenHash` kept — the unique column needs a value; the status makes it unusable). After commit: `added.audit()`, audit `invitation.accepted { role, membershipStatus }`, `guardianRequest.notify(...)` (audit `guardian.consent_requested` + `guardian.consent_requested` email naming workspace and teacher), `mailer.sendAccepted` (to the inviter), `InvitationAcceptedEvent`; `REGISTER` → `sessions.createSession(user, { ...meta, remember: false })` + `setAuthCookies`. A TEACHER/ADMIN accepting `REGISTER` gets **no** PERSONAL workspace (assert).
- `GuardianRequestService` (`guardian/`): `start(tx: TenantTx, { workspaceId, studentUserId, guardianEmail }): Promise<{ link: GuardianLink; raw: string }>` — upsert on `(studentUserId, workspaceId)`: new row `PENDING` or an existing `REFUSED`/`REVOKED`/`PENDING` row re-armed (`status PENDING`, `guardianEmail`, `consentTokenHash`, `consentExpiresAt = now + 14 d`, `consentSentAt = now`, `consentResentCount` kept); `notify({ link, raw, student, workspace, teacher })`: email `guardian.consent_requested` to `guardianEmail` in `workspace.defaultLocale` (the guardian has no account) with `guardianConsentLink`, audit `guardian.consent_requested { guardianEmailMasked, consentExpiresAt }`. `resend(tx, link)`: `consentSentAt > now − 600 s` → `429`; new token, expiry, `+1`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/invitations/accept.e2e-spec.ts
it('preview: anonymous → ANONYMOUS + emailMasked; the invited user signed in → MATCH; another user → MISMATCH; unknown token → 410 TOKEN_INVALID and counts an attempt', ...);
it('AC-INV-03: existing account joins → Membership STUDENT ACTIVE, assignment in a PERSONAL workspace, invitation ACCEPTED, inviter emailed invitation.accepted, event emitted', ...);
it('AC-INV-02: signed in as sarah → 403 INVITATION_EMAIL_MISMATCH with details.emailMasked = a***@example.com; nothing changes', ...);
it('REGISTER (adult): account created with emailVerifiedAt set, TERMS+PRIVACY consents, cookies set, 201 user + membershipStatus ACTIVE; a second accept → 410 INVITATION_ALREADY_ACCEPTED', ...);
it('AC-INV-09: REGISTER with a minor birth date and a guardian email → PENDING_GUARDIAN_CONSENT, GuardianLink PENDING (14 d), guardian.consent_requested email naming the workspace and the teacher, then every /workspaces/{wid}/... call → 403 GUARDIAN_CONSENT_REQUIRED', ...);
it('minor without guardian email → 422 GUARDIAN_EMAIL_REQUIRED; guardian email equal to the student → 422 GUARDIAN_EMAIL_INVALID; student without birth date anywhere → 422 BIRTH_DATE_REQUIRED', ...);
it('AC-INV-13: a minor already consented in workspace A accepts B → a second GuardianLink (B) PENDING, B-named email, A consent and A link untouched', ...);
it('Review Focus 2: JOIN by an adult account whose invitation carries a minor birthDate stays non-ACTIVE (the invitation birthDate wins only when the account has none; a conflicting minor body birthDate makes him a minor) — expectMinorInvariant', ...);
it('AC-WS-08: a teacher accepting an organisation invitation by REGISTER has no PERSONAL workspace; /me/workspaces lists only the organisation', ...);
it('Review Focus 3: two concurrent accepts of one invitation → one 201, one 410 INVITATION_ALREADY_ACCEPTED, one membership', ...);
it('Review Focus 1: the token of A is unusable after a resend (410 TOKEN_INVALID), and preview/accept never reach another workspace\'s row', ...);
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/api exec vitest run test/invitations/accept` — Expected: FAIL.
- [ ] **Step 3: Implement**; regenerate OpenAPI; `RegisterService.registerTeacher` keeps its tests green after the extraction.
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/api --concurrency=2 && git diff --exit-code packages/contracts/openapi` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/api packages/contracts && git commit -m "feat(api): public invitation preview and acceptance — register or join, strict email binding, minors start the per-workspace guardian consent (AC-INV-02, 03, 09, 13)"
```

---

### Task 6: Invite links (group codes) — CRUD, public join, approval queue (AC-INV-08; Review Focus 3)

Depends on T5 (`AcceptService` primitives, `GuardianRequestService`).

**Files:**

- Create: `apps/api/src/invite-links/{invite-links.module,invite-links.controller,invite-links.service,join.controller,join.service,approval.controller,approval.service,code,dto}.ts`, `apps/api/src/invite-links/code.spec.ts`, `apps/api/test/invite-links/{invite-links,join,approval}.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/invitations/accept.service.ts` (export `prepareStudentIdentity(...)` and `createOrJoinInTx(...)` so the join path reuses them), `apps/api/test/isolation/fixtures.ts` (`invite-links/:id`, `FOREIGN_BODIES` for `POST …/invite-links` `{ teacherUserId: p.b.teacher.id }`, `members/:uid/approve|reject` already covered by `:uid`), `packages/contracts/{openapi/openapi.json,src/generated/api.d.ts}`

**Interfaces:**

- `code.ts`: `generateInviteCode(): string` (8 chars from `INVITE_CODE_ALPHABET`, `randomBytes(8)` modulo 32 — the alphabet length is a power of two, so no modulo bias).
- `InviteLinksController` (`workspaces/:wid/invite-links`, `@RequirePermission('student.invite')`): `GET` → `InviteLink[]` (no pagination; a workspace has a handful), `POST` (`@RequireVerifiedTeacher()`) → `201`, `PATCH ':id'`, `DELETE ':id'` → `204` (= `status DISABLED`). Defaults: `requiresApproval = workspace.type === 'ORGANIZATION'`, `maxUses = 50`, `expiresAt = now + 30 d`; `teacherUserId` rules as T4; scope `own` → rows the caller created. Audit `invite_link.created { code, maxUses, expiresAt, requiresApproval }`, `invite_link.updated` (before/after of changed keys).
- `JoinController` (`@Controller('join')`, `@OptionalAuth()`): `GET ':code'` → `JoinPreview` (`normaliseInviteCode` → `null` → `404`; `limiter.assertAllowed('join')`, miss → `failed` + `404 NOT_FOUND`; `DISABLED`/`EXHAUSTED`/expired → `410 INVITE_LINK_*`); `POST ':code/accept'` (`AcceptJoinDto`) → `201 AcceptResult`.
- `JoinService.accept`: identity rules of T5 (`REGISTER` needs `email`; existing account → `409 EMAIL_TAKEN`; `JOIN` needs a session); `withTenantTx(wid)`: `SELECT … FOR UPDATE` on the link, re-check status/expiry/`usesCount < maxUses` (`410`), `usesCount + 1` and `status = usesCount === maxUses ? 'EXHAUSTED' : status`; `REGISTER` → `createAccountInTx` with `emailVerifiedAt = null` + `EMAIL_VERIFY` token (`EmailVerificationService.newToken`, sent after commit — the SP1 `auth.verify_email` email); membership status: `requiresApproval → 'PENDING_APPROVAL'`, else `minor → 'PENDING_GUARDIAN_CONSENT'` (+ `guardianRequest.start`), else `'ACTIVE'`; `invitedByUserId = link.createdByUserId`; assignment when `teacherUserId` or a teaching creator in an organisation; audit `invite_link.used { linkId, membershipStatus }` + `member.added`. Cookies set on `REGISTER` (the account can only reach `/verify-email` until verified — SP1 gates).
- `ApprovalController` (`workspaces/:wid/members/:uid/approve|reject`, `@RequirePermission('student.invite')`): `POST` → `200 MemberSummary`. `ApprovalService`: membership must be `PENDING_APPROVAL` (`409 MEMBERSHIP_NOT_PENDING`); scope `own` → `invitedByUserId === ctx.userId` else `404`; `approve`: minor without an active consent → `PENDING_GUARDIAN_CONSENT` + `guardianRequest.start` + notify (D5), else `ACTIVE` (`joinedAt`); audit `member.approved`; email `join.approved`; `reject` → `REJECTED`, `removedAt`, `removalReason: 'REJECTED'`, audit `member.rejected`, email `join.rejected`, `MembershipDeactivatedEvent(... 'REJECTED')`.

- [ ] **Step 1: Write the failing tests**

```ts
// invite-links.e2e-spec.ts: create with defaults (ORGANIZATION → requiresApproval true, 50 uses, 30 d, url ends with /join/{code}); code is 8 chars of the alphabet; PATCH disable; DELETE → DISABLED and the code answers 410 INVITE_LINK_DISABLED; scope own; verified-teacher gate
// join.e2e-spec.ts
it('AC-INV-08: requires_approval + max_uses 2: two students become PENDING_APPROVAL, the third gets 410 INVITE_LINK_EXHAUSTED, usesCount = 2, link EXHAUSTED', ...);
it('REGISTER through a code creates an UNVERIFIED account and sends auth.verify_email; JOIN by an existing member → 409 ALREADY_MEMBER', ...);
it('personal workspace, adult, no approval → ACTIVE at once with the owner assignment; a minor → PENDING_GUARDIAN_CONSENT and the consent email', ...);
it('Review Focus 3: two concurrent accepts on the last use → one 201, one 410, usesCount = maxUses', ...);
it('unknown code → 404 and the attempt limiter trips at 10 (429)', ...);
// approval.e2e-spec.ts
it('approve → ACTIVE + join.approved; approve a minor → PENDING_GUARDIAN_CONSENT + consent email (D5, expectMinorInvariant); reject → REJECTED + event; a non-pending member → 409 MEMBERSHIP_NOT_PENDING; org TEACHER may only approve students of his own link (404 otherwise)', ...);
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/api exec vitest run test/invite-links src/invite-links` — Expected: FAIL.
- [ ] **Step 3: Implement**; regenerate OpenAPI; isolation fixtures.
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/api --concurrency=2 && git diff --exit-code packages/contracts/openapi` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/api packages/contracts && git commit -m "feat(api): group invite links with codes, public join with approval and use limits, member approve/reject (AC-INV-08)"
```

---

### Task 7: Guardian consent API — public consent page, guardian page (view / revoke / re-grant), resend routes, `/me/workspaces` guardian info (AC-INV-10, 11, 12 resend, AC-SAFE-06; Review Focus 4)

Depends on T5 (`GuardianRequestService`).

**Files:**

- Create: `apps/api/src/guardian/{guardian.module,guardian.controller,guardian.service,guardian-mailer.service,me-guardian.controller,dto}.ts`, `apps/api/test/guardian/{consent,guardian-page,resend}.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/me/me.service.ts` (`workspaces()` adds `guardian` for `STUDENT` memberships through `crossTenantDb().guardianLink.findMany({ where: { studentUserId: userId } })`), `packages/db/src/tenant.ts` + `tenant.test.ts` (`hasCrossTenantFilter` accepts `studentUserId` on `GuardianLink` as a user-scoped filter, exactly like `userId` — it is the data subject's id, not a secret column, so it does not go into `CROSS_TENANT_LOOKUP_KEYS`), `packages/contracts/src/me.ts` (`MyWorkspaceSchema.guardian: GuardianInfoSchema.nullable().optional()`), `apps/api/test/isolation/fixtures.ts` (`students/:uid/guardian/resend-consent` is covered by `:uid`), `packages/contracts/{openapi/openapi.json,src/generated/api.d.ts}`

**Interfaces:**

- `GuardianController` (`@Public()`): `GET /guardian-consent/:token` → `GuardianConsentPreview`; `POST /guardian-consent/:token` (`GuardianDecisionDto`) → `200 { decision, guardianPageUrl? }`; `GET /guardian/:token` → `GuardianView`; `POST /guardian/:token/revoke` → `204`; `POST /guardian/:token/grant` (`GuardianRegrantDto`) → `200`. Every route: `limiter.assertAllowed('guardian', ip)` then `crossTenantDb().guardianLink.findFirst({ where: { consentTokenHash | sessionsViewTokenHash } })`; miss → `failed` + `410 TOKEN_INVALID`.
- `GuardianService`:
  - `previewConsent(token)`: link `PENDING` with `consentExpiresAt > now` else `410 CONSENT_LINK_EXPIRED` (past) / `410 CONSENT_ALREADY_DECIDED` (token cleared → `TOKEN_INVALID` in practice; the `decidedAt` branch covers a race); `teacher` = inviter of the membership (`invitedByUserId`) or the workspace owner; `noticeUrl = ${WEB_ORIGIN}/${locale}/legal/minors`.
  - `decide(token, body, meta)`: `withTenantTx(wid)`: lock the link, re-check; `GRANT` → `tx.consent.create({ userId: student, grantedByEmail, type: 'GUARDIAN_PARENTAL', version: GUARDIAN_CONSENT_VERSION, granted: true, grantedAt, ip, userAgent, workspaceId })`, link `ACTIVE` + names + relationship + `consentId` + `decidedAt` + `consentTokenHash = null` + `sessionsViewTokenHash = hash(new)`, membership `updateMany({ where: { userId, status: { in: ['PENDING_GUARDIAN_CONSENT','SUSPENDED_NO_CONSENT','SUSPENDED_CONSENT_REVOKED'] } }, data: { status: 'ACTIVE', joinedAt: joinedAt ?? now } })` (count 0 → the membership is `REMOVED`/`REJECTED` meanwhile → consent recorded, link `ACTIVE`, membership untouched, response still 200 — Review Focus 2); `REFUSE` → link `REFUSED`, `decidedAt`, token cleared, membership → `SUSPENDED_NO_CONSENT` (from `PENDING_GUARDIAN_CONSENT` only). After commit: audit `guardian.consent_granted { relationship, version }` / `guardian.consent_refused`, emails (`guardian.consent_confirmation` to the guardian with `guardianPageLink`, `guardian.consent_granted` to the student in his locale, `guardian.consent_granted_teacher` to the teacher; or `guardian.consent_refused` ×2), `MembershipActivatedEvent` / `MembershipDeactivatedEvent('SUSPENDED_NO_CONSENT', 'CONSENT_REFUSED')`.
  - `view(token)`: link `ACTIVE | REVOKED | REFUSED` (a `PENDING` link has no page token); `sessions: []` (doc comment: SP5 fills it with that workspace's sessions of that student only — AC-SAFE-06).
  - `revoke(token, meta)`: link must be `ACTIVE` (`409 GUARDIAN_LINK_INACTIVE`); `withTenantTx`: `consent.update({ revokedAt })`, link `REVOKED` + `revokedAt`, membership `ACTIVE → SUSPENDED_CONSENT_REVOKED` (conditional); after: audit `guardian.consent_revoked`, emails to student, teacher and, for an organisation, every ACTIVE OWNER/ADMIN (`guardian.consent_revoked`, `recipientRole: 'TEACHER'`), `MembershipDeactivatedEvent('SUSPENDED_CONSENT_REVOKED', 'CONSENT_REVOKED')`. Nothing else changes (no purge: assert the student's user row, consent history and other memberships are intact).
  - `regrant(token, body, meta)`: link `REVOKED | REFUSED` (`409 GUARDIAN_LINK_INACTIVE` otherwise); same as `GRANT` with a fresh `Consent` row and a **new** page token (the old page link answers `410 TOKEN_INVALID`).
  - `resendForStudent(ctx, wid, uid)` (`POST /workspaces/{wid}/students/{uid}/guardian/resend-consent`, mounted in T8's controller but implemented here) and `resendForSelf(user, wid)` (`POST /me/workspaces/:wid/guardian/resend-consent`, `MeGuardianController`, `@Controller('me/workspaces/:wid/guardian')`, `@CrossTenant()`): membership (found through `crossTenantDb().membership.findFirst({ where: { userId } })` for self, `tenantDb` for the teacher) must be `PENDING_GUARDIAN_CONSENT | SUSPENDED_NO_CONSENT | SUSPENDED_CONSENT_REVOKED` (else `409 MEMBERSHIP_NOT_PENDING`); `guardianRequest.resend(tx, link)` (`429` within 10 min); link → `PENDING` (membership unchanged); notify. The self route is not under `workspaces/:wid` so `WorkspaceContextGuard` ignores it (D12); it filters by `userId` and is listed in the runbook as a deliberate `/me` route.
- `MeService.workspaces`: `guardian` = `{ emailMasked: maskEmail(link.guardianEmail), status: link.status, consentExpiresAt }` for `STUDENT` memberships with a link, else `null`.

- [ ] **Step 1: Write the failing tests**

```ts
// consent.e2e-spec.ts
it('AC-INV-10: GRANT → Consent GUARDIAN_PARENTAL (ip, user-agent, version guardian-2026-10, workspaceId), GuardianLink ACTIVE with names, membership ACTIVE, student + teacher emailed, guardian gets the confirmation with a /guardian/ link; the consent token is single-use (second POST → 410 TOKEN_INVALID); expectMinorInvariant', ...);
it('REFUSE → link REFUSED, membership SUSPENDED_NO_CONSENT, no Consent row, two emails, MembershipDeactivatedEvent', ...);
it('preview of an expired link → 410 CONSENT_LINK_EXPIRED; GRANT without acceptNotice → 422 on acceptNotice; relationship outside the enum → 422', ...);
it('Review Focus 2: GRANT on a link whose membership was REMOVED meanwhile records the consent but leaves the membership REMOVED', ...);
// guardian-page.e2e-spec.ts
it('AC-SAFE-06: the page of (Ahmed, A) shows Ahmed, workspace A, the teacher and sessions: []; the same guardian consented in B → B is not in the payload; an A token never reads B rows (Review Focus 4)', ...);
it('AC-INV-11: revoke in A → SUSPENDED_CONSENT_REVOKED in A within the request, consent.revokedAt set, B stays ACTIVE, teacher + admin emailed, no row deleted (user, consents, memberships counts unchanged); revoke again → 409 GUARDIAN_LINK_INACTIVE', ...);
it('re-grant after revocation → new Consent row, membership ACTIVE, the old page token answers 410, the new page works', ...);
// resend.e2e-spec.ts
it('teacher resend → new consent token, 14 d, PENDING link, SUSPENDED_NO_CONSENT membership unchanged until the guardian grants; second resend within 10 min → 429; an ACTIVE member → 409 MEMBERSHIP_NOT_PENDING', ...);
it('student self-resend on /me/workspaces/{wid}/guardian/resend-consent works while his membership is inactive; another workspace id → 404; /me/workspaces carries guardian { emailMasked, status, consentExpiresAt }', ...);
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/api exec vitest run test/guardian` — Expected: FAIL.
- [ ] **Step 3: Implement**; `tenant.ts` `studentUserId` rule + test; regenerate OpenAPI; `test/isolation/tenant-routes.e2e-spec.ts` must still enumerate only `/workspaces/:wid` routes (the `/me/workspaces/:wid/...` path starts with `me/`, so `isWorkspaceRoute` ignores it — add an explicit assertion in `workspace-context.e2e-spec.ts` that this route is not treated as a tenant route).
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/db --filter=@nibras/contracts --filter=@nibras/api --concurrency=2 && git diff --exit-code packages/contracts/openapi` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/api packages/db packages/contracts && git commit -m "feat(api): guardian consent — public grant/refuse, guardian page with revoke and re-grant, consent resend for teachers and students (AC-INV-10, 11, AC-SAFE-06)"
```

---

### Task 8: Students API — list, profile skeleton, patch, removal wiring; isolation fixtures (AC-WS-02 for students)

Depends on T7.

**Files:**

- Create: `apps/api/src/students/{students.module,students.controller,students.service,dto}.ts`, `apps/api/test/students/students.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/members/members.service.ts` (`ownScope` becomes `public`, reused), `apps/api/test/isolation/fixtures.ts` (`FOREIGN_BODIES['PATCH /workspaces/:wid/students/:uid']` → `{ guardianEmail: 'x@y.z' }` with B's uid in the path — covered by params; add `students/:uid` → `p.b.student.id`), `packages/contracts/{openapi/openapi.json,src/generated/api.d.ts}`

**Interfaces:**

- `StudentsController` (`workspaces/:wid/students`): `GET` (`@RequirePermission('student.read')`, `StudentsQueryDto`) → `StudentsPage`; `GET ':uid/profile'` (`student.read`) → `StudentProfile`; `PATCH ':uid'` (`student.update`, `UpdateStudentDto`) → `StudentSummary`; `POST ':uid/guardian/resend-consent'` (`student.update`, `@RequireVerifiedTeacher()`) → `204` (delegates to `GuardianService.resendForStudent`).
- `StudentsService`:
  - `list(ctx, q)`: `tenantDb(wid).membership.findMany({ where: { role: 'STUDENT', status: q.status ?? { notIn: ['REMOVED','REJECTED'] }, ...(scope own → MembersService.ownScope) }, include: { user } })` + one `guardianLink.findMany({ where: { studentUserId: { in } } })` (tenant-scoped, so only this workspace's links) → `StudentSummary` (`isMinor` from `user.birthDate`; `email` and `guardian.email` only for scope `all`, else `emailMasked` only — Q7; `progressPercent`/`attendanceRate`/`lastActivityAt` `null`, `courses: []`); same keyset cursor as members.
  - `profile(ctx, uid)`: membership any status (`REMOVED` included for the teacher's history, §8.3.6) else `404`; `invitedBy` name through `user` lookup of `invitedByUserId`; `assignedTeachers` from `teacherStudentAssignment` (names via `membership.user`); empty sections.
  - `update(ctx, uid, input)`: `guardianEmail` on an adult (`!isMinor`) → `422 VALIDATION_FAILED` on `guardianEmail`; equal to the student's email → `422 GUARDIAN_EMAIL_INVALID`; `withTenantTx`: upsert the link's `guardianEmail` (a link `ACTIVE` with another email → the old consent stays valid until revoked; the new email receives nothing until a resend — documented); when the membership is in a consent status → `guardianRequest.resend` to the new address (no cooldown check for an address change; `consentResentCount` kept); audit `guardian.email_changed { before: masked, after: masked }` + `student.updated`.
- Scope checks: `ownScope` returns the `Prisma.MembershipWhereInput` of SP1 (assigned to or invited by the caller); an org TEACHER reading `/students/{uid}/profile` of an unassigned student → `404`.

- [ ] **Step 1: Write the failing tests**

```ts
it('AC-WS-02 (students): an org TEACHER with 2 assigned students of 50 lists 2 without emails; the ADMIN lists 50 with emails and guardian emails', ...);
it('list carries guardian status and isMinor; status filter PENDING_GUARDIAN_CONSENT; q matches names; keyset pagination is stable (limit 2 over 5 rows, no duplicate, no gap)', ...);
it('profile: skeleton sections are empty arrays / null; invitedBy and assignedTeachers resolved by name; a REMOVED student is still readable by the teacher; an unassigned student → 404 for an org TEACHER', ...);
it('PATCH guardianEmail: adult → 422; same as student → 422 GUARDIAN_EMAIL_INVALID; pending minor → link email replaced, new consent email to the new address, audit guardian.email_changed with masked values', ...);
it('resend-consent route → 204 and the GuardianRequestService cooldown (429)', ...);
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/api exec vitest run test/students` — Expected: FAIL.
- [ ] **Step 3: Implement**; fixtures; OpenAPI.
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/api --concurrency=2 && git diff --exit-code packages/contracts/openapi` — Expected: PASS; isolation suite green (every new `:id`/`:uid` route has a fixture).
- [ ] **Step 5: Commit**

```bash
git add apps/api packages/contracts && git commit -m "feat(api): students list with guardian status, profile skeleton, guardian email update and consent resend; isolation fixtures for sp2 routes"
```

---

### Task 9: Worker — daily `guardian_consent.expire` and `invitation.expire` with BullMQ job schedulers, system audit (AC-INV-12)

Depends on T1, T2 (templates). Independent of T4–T8 at the code level (reads tables directly).

**Files:**

- Create: `apps/worker/src/system-audit.ts` (+ `.test.ts`), `apps/worker/src/schedulers.ts`, `apps/worker/src/processors/expiry.processor.ts`, `apps/worker/test/expiry.e2e-spec.ts`, `apps/worker/test/schedulers.e2e-spec.ts`
- Modify: `apps/worker/src/worker.module.ts` (providers `ExpiryProcessor`, `Schedulers`), `docs/runbooks/auth-and-tenancy.md` (jobs table: the two schedulers)

**Interfaces:**

- `writeSystemAudit(db: PrismaClient, entry: { workspaceId: string | null; action: string; entityType: string; entityId?: string; before?: unknown; after?: unknown }, jobId: string): Promise<void>` — inserts an `audit_log` row with `actorUserId = null`, `actorRole = 'SYSTEM'`, `requestId = 'job:{jobId}'`; strips the same secret keys as the API (`REDACT_KEYS` + `/hash|secret|password|token/i`); never throws (logs `audit write failed`).
- `Schedulers` (`OnApplicationBootstrap`, after `QueueRegistry`): `queues.get('compliance').upsertJobScheduler('guardian-consent-expire', { pattern: DAILY_SCHEDULER_PATTERN, tz: 'UTC' }, { name: GUARDIAN_CONSENT_EXPIRE_JOB, data: {} })` and the same for `invitation-expire` / `INVITATION_EXPIRE_JOB`; idempotent across restarts (BullMQ upsert); `SCHEDULERS` exported for the test.
- `ExpiryProcessor` (`compliance` queue):
  - `guardianConsentExpire(job)`: loop in batches of 500 over `guardianLink.findMany({ where: { status: 'PENDING', consentExpiresAt: { lt: now } }, orderBy: { id: 'asc' } })`; per row, one `$transaction`: `guardianLink.update({ consentTokenHash: null })` (status stays `PENDING`, so a resend re-arms it — §8.3.5 « relance »), `membership.updateMany({ where: { workspaceId, userId: studentUserId, status: 'PENDING_GUARDIAN_CONSENT' }, data: { status: 'SUSPENDED_NO_CONSENT' } })`; then `writeSystemAudit(… 'guardian.consent_expired', workspaceId …)`, emails `guardian.consent_expired` to the student (his locale) and the teacher (`invitedByUserId` or the workspace owner); progress `{ processed, lastId }` so a retry resumes after `lastId`; result `{ expired: n, notified: n }`. **No** user row, consent row or other membership is touched (assert in the test). The `workspace_id` of each row is logged (PRD §13.3).
  - `invitationExpire(job)`: `invitation.updateMany({ where: { status: 'PENDING', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } })` in id batches, one system audit `invitation.expired` per row (`after: { email }`), no email; result `{ expired: n }`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/worker/test/expiry.e2e-spec.ts (WorkerModule with InMemoryEmailProvider; fixtures through WORKER_DB)
it('AC-INV-12: a PENDING link 15 days old → membership SUSPENDED_NO_CONSENT, token cleared, status PENDING kept, audit guardian.consent_expired (SYSTEM, workspace_id), student + teacher emailed; the student\'s other ACTIVE membership, user row and consent rows are untouched; a second run expires nothing', ...);
it('a link whose membership is already SUSPENDED_CONSENT_REVOKED or REMOVED is not changed; a PENDING link 13 days old is left alone', ...);
it('retry after a failed email resumes after lastId and never emails the first batch twice (failFor)', ...);
it('invitation.expire flips PENDING past expiresAt to EXPIRED with an audit row each; ACCEPTED/REVOKED untouched', ...);
// schedulers.e2e-spec.ts: after bootstrap, compliance.getJobSchedulers() has the two ids with pattern '0 3 * * *'; a second bootstrap does not duplicate them
// system-audit.test.ts: strips tokenHash/consentTokenHash keys, actorRole SYSTEM, requestId job:{id}
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/worker exec vitest run test/expiry test/schedulers src/system-audit` — Expected: FAIL.
- [ ] **Step 3: Implement**; runbook jobs table.
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/worker --concurrency=2` — Expected: PASS. Manual: `pnpm dev`, worker log shows `job scheduler upserted guardian-consent-expire` once.
- [ ] **Step 5: Commit**

```bash
git add apps/worker docs && git commit -m "feat(worker): daily guardian-consent and invitation expiry jobs with bullmq job schedulers; system audit rows (AC-INV-12)"
```

---

### Task 10: CSV import — API preview and confirm, worker processor, report download (AC-INV-07; Review Focus 5)

Depends on T4 (invitation rules), T9 (system audit).

**Files:**

- Create: `apps/api/src/imports/{imports.module,imports.controller,imports.service,csv.ts,dto}.ts`, `apps/api/src/imports/csv.spec.ts`, `apps/api/test/imports/imports.e2e-spec.ts`, `apps/worker/src/processors/imports.processor.ts`, `apps/worker/test/imports.e2e-spec.ts`
- Modify: `apps/api/package.json` + `apps/worker/package.json` (`csv-parse@6.1.0`), `pnpm-lock.yaml`, `apps/api/src/app.module.ts`, `apps/api/src/invitations/invitations.controller.ts` (nothing — the import routes live in `ImportsController` with path `workspaces/:wid/invitations/import`, registered **before** `InvitationsModule` in `AppModule.imports` so Express matches `import` before `:id`; add a route-order test), `apps/worker/src/worker.module.ts`, `apps/api/test/isolation/fixtures.ts` (`invitations/import/:importId` → `p.b.import.id`; `POST …/invitations/import` goes to `BODYLESS_WRITE_ROUTES` with the reason "the CSV body carries emails only, no ids"), `packages/contracts/{openapi/openapi.json,src/generated/api.d.ts}`

**Interfaces:**

- `csv.ts`: `parseImportCsv(content: string): { rows: ParsedRow[]; errors: RowError[] }` — strips a UTF-8 BOM, detects `,` or `;` from the header line, requires an `email` header (case-insensitive, trimmed; unknown columns ignored), `csv-parse/sync` with `columns: true, skip_empty_lines: true, relax_column_count: true, trim: true, bom: true`; `> IMPORT_MAX_ROWS` data rows → `413 IMPORT_TOO_LARGE`; per row: email normalised (trim/lower) and validated with the contracts email regex, `birth_date` through `BirthDateSchema`, `guardian_email` validated, `course_codes` split on `;`; outcomes `INVALID_EMAIL`, `INVALID_BIRTH_DATE`, `INVALID_GUARDIAN_EMAIL`, `DUPLICATE_IN_FILE` (second occurrence), `OK_COURSES_IGNORED` (non-empty codes, SP3 will resolve them), `OK_GUARDIAN_AT_ACCEPT` (minor without guardian email), `OK`.
- `ImportsService.preview(ctx, input)`: parse, then one query each for `ALREADY_MEMBER` (`membership` joined on `user.email in (...)`) and `ALREADY_INVITED` (`invitation` PENDING in emails) → `ImportPreview` (`validRows` = outcomes starting with `OK`). `confirm(ctx, input)`: same, `validRows === 0` → `422 IMPORT_NO_VALID_ROWS`; a `QUEUED | RUNNING` import in the workspace → `409 IMPORT_IN_PROGRESS`; `invitationImport.create({ rows: validRows, report: invalidRows (already final), totalRows, validRows })`; `queue.add(QUEUES.imports, INVITATIONS_IMPORT_JOB, { importId, workspaceId }, { jobId: importJobId(importId) })`; audit `invitations.import_started { fileName, totalRows, validRows }`; `202 { importId }`. `status(ctx, id)` → `ImportStatus` (scope `own` → `createdByUserId === ctx.userId`). `report(ctx, id)` → `text/csv; charset=utf-8` with BOM, header `line,email,outcome,message`, `Content-Disposition: attachment; filename="import-{id}.csv"` (`@Res()` streaming a string).
- `ImportsController` (`workspaces/:wid/invitations/import`, `@RequirePermission('student.invite')`): `POST` (`@RequireVerifiedTeacher()`, `ImportRequestDto`, `ImportQueryDto` `dryRun`) → `200 ImportPreview` or `202 ImportAccepted`; `GET ':importId'`; `GET ':importId/report'`.
- Worker `ImportsProcessor.importCsv(job)` (`imports` queue): load the import (`QUEUED | RUNNING` else `{ skipped }`), `status RUNNING`, `startedAt`; for `i` from `processedRows`: in one `$transaction` per row: live membership → `ALREADY_MEMBER`; PENDING invitation → `ALREADY_INVITED`; else `invitation.create({ ..., tokenHash: hash, expiresAt: now + 7 d, status PENDING, invitedByUserId: import.createdByUserId, teacherUserId: creator teaching in an org ? creator : null, lastSentAt: now })`; outside the transaction: email `invitation.received_student` (workspace locale) with `invitationLink`. **Email failure** → row outcome `FAILED` with the message, the invitation stays (the teacher resends from the pending tab), the loop continues. **Any other error** (database, provider construction) propagates: the job fails and BullMQ retries; `processedRows` is persisted after every row and `job.updateProgress(processedRows)` is called, so the retry resumes at the first unprocessed row and a pending invitation it finds counts as `ALREADY_INVITED`. Each outcome is appended to `report`, `createdCount`/`failedCount` updated; end: `COMPLETED`, `finishedAt`, system audit `invitations.import_completed`, email `imports.completed` to the creator with the students-page link. Attempt exhaustion (`job.attemptsMade + 1 >= job.opts.attempts` in the catch) → `FAILED` + `error` before rethrowing.

- [ ] **Step 1: Write the failing tests**

```ts
// csv.spec.ts: BOM + ';' delimiter; missing email header → error; 501 rows → IMPORT_TOO_LARGE; outcomes per row; duplicates case-insensitive
// imports.e2e-spec.ts
it('AC-INV-07 preview: 100 rows with 3 invalid emails and 2 duplicates → validRows 95, the 5 lines flagged, no row written, no job', ...);
it('confirm → 202 importId, InvitationImport QUEUED with 95 rows, job { importId, workspaceId } with jobId import:{id}, audit invitations.import_started; a second confirm while QUEUED → 409 IMPORT_IN_PROGRESS; status endpoint; report csv has a BOM and 5 lines before the worker runs', ...);
it('a 1.2 MB content → 413; only invalid rows → 422 IMPORT_NO_VALID_ROWS; org TEACHER sees only his imports', ...);
it('route order: GET /invitations/import/{id} is not captured by GET /invitations/{id}', ...);
// apps/worker/test/imports.e2e-spec.ts
it('AC-INV-07 job: creates 95 PENDING invitations with hashed tokens, sends 95 emails with /invite/ links, COMPLETED, createdCount 95, imports.completed email, audit row', ...);
it('Review Focus 5a: an email failure on row 41 (failFor) marks that row FAILED, the job completes with createdCount 95 and failedCount 1, the row\'s invitation exists and is resendable', ...);
it('Review Focus 5b: a database error on row 41 (vi.spyOn(db.invitation, "create").mockRejectedValueOnce) fails the job at processedRows 40; the second run creates and emails rows 41–95 only; no address receives two emails; COMPLETED with createdCount 95', ...);
it('rows already invited/member at run time (invited between preview and run) → ALREADY_INVITED / ALREADY_MEMBER, nothing sent', ...);
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/api exec vitest run src/imports test/imports && pnpm --filter @nibras/worker exec vitest run test/imports` — Expected: FAIL.
- [ ] **Step 3: Implement** — `pnpm --filter @nibras/api add csv-parse@6.1.0 && pnpm --filter @nibras/worker add csv-parse@6.1.0`; API module (registered before `InvitationsModule`), worker processor; OpenAPI.
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/api --filter=@nibras/worker --concurrency=2 && pnpm audit --prod --audit-level=high && git diff --exit-code packages/contracts/openapi` — Expected: PASS; audit exit 0.
- [ ] **Step 5: Commit**

```bash
git add apps/api apps/worker packages/contracts pnpm-lock.yaml && git commit -m "feat(api,worker): csv student import — dry-run preview, queued job with per-row report and resume, downloadable report (AC-INV-07)"
```

---

### Task 11: Web — public invitation and join pages, student waiting panel, dashboard badges (AC-INV-02, 03 UI; Review Focus 6)

Depends on T5, T6, T7 (API). First web task.

**Files:**

- Create: `apps/web/src/app/[locale]/(public)/layout.tsx` (auth-card frame without the signed-in redirect of `(auth)`), `(public)/invite/[token]/page.tsx` (+ `loading.tsx`), `(public)/join/[code]/page.tsx`, `apps/web/src/components/invitation-accept-form.tsx` (+ `.test.tsx`), `apps/web/src/components/join-form.tsx` (+ `.test.tsx`), `apps/web/src/components/membership-pending-panel.tsx` (+ `.test.tsx`), `apps/web/src/lib/membership-status.ts` (badge variant + label key per status), `apps/web/e2e/invitations.spec.ts`
- Modify: `apps/web/src/app/[locale]/(app)/app/w/[wid]/layout.tsx` (403 handling → `MembershipPendingPanel`), `apps/web/src/app/[locale]/(app)/app/(home)/page.tsx` (status badge per workspace row), `apps/web/src/lib/navigation.ts` (no nav for a non-ACTIVE membership's workspace section beyond the pending page), `packages/i18n/messages/{fr,ar,en}.json` (`invite.*`, `join.*`, `pending.*`, `errors.*` for the SP2 codes), `apps/web/src/proxy.ts` only if the `(public)` paths need to be excluded from an auth redirect (verify; expected: no change)

**Interfaces:**

- `/invite/[token]` (server component): `serverApi().GET('/invitations/{token}')`; `410` → `StatusPage` with `invite.expired` (« Invitation expirée — demandez à votre professeur de la renvoyer »), `invite.revoked`, `invite.accepted`; `200` → `<InvitationAcceptForm preview token locale />`.
- `InvitationAcceptForm` (client): `viewer === 'MISMATCH'` → `Alert warning` « Cette invitation est destinée à {emailMasked} » + button « Se déconnecter et continuer avec {emailMasked} » (`POST /auth/logout` then `router.refresh()`); `viewer === 'MATCH'` → card « Rejoindre l'espace de {inviter} ? » + **Rejoindre** (`JOIN`), with `birthDate` / `guardianEmail` fields when `requiresBirthDate` / minor; `ANONYMOUS && accountExists` → « Un compte existe déjà pour cette adresse » + link `/login?next=/invite/{token}`; `ANONYMOUS` → register form (`Field`s prénom, nom, mot de passe, langue (`Select`), fuseau (`useTimezones`), date de naissance (`type="date"`, students; `min`/`max`), tuteur email revealed when `isMinor(birthDate)` (from `@nibras/contracts/web`) unless `guardianEmailPrefilled`, CGU + confidentialité checkboxes with the legal links as on `/register`); `useSubmit` → `api.POST('/invitations/{token}/accept')`; errors through `issuesToFieldErrors` + `apiErrorMessage`; success → `router.replace`: `role !== 'STUDENT'` → `/app/settings/verification`; `membershipStatus === 'PENDING_GUARDIAN_CONSENT'` → `/app/w/{wid}`; else `/app`.
- `/join/[code]`: same with `JoinForm` (adds `email`); success: `PENDING_APPROVAL` → `StatusPage` « Demande envoyée — en attente de l'approbation de {teacher} »; unverified `REGISTER` → `/verify-email`.
- `MembershipPendingPanel({ membership: MyWorkspace })`: variants by `status`: `PENDING_GUARDIAN_CONSENT` → « En attente du consentement de votre tuteur ({emailMasked}) » + **Renvoyer l'email** (`POST /me/workspaces/{wid}/guardian/resend-consent`; `429` → disabled with « Réessayez dans {min} min » from `details.retryAfterS`); `SUSPENDED_NO_CONSENT` → « Votre tuteur n'a pas répondu / a refusé » + resend; `SUSPENDED_CONSENT_REVOKED` → « Consentement retiré par votre tuteur » + resend; `PENDING_APPROVAL` → « En attente de l'approbation de votre professeur » (no action). Rendered by the workspace layout when `GET /workspaces/{wid}` answers `403` with code `GUARDIAN_CONSENT_REQUIRED` or `MEMBERSHIP_INACTIVE` (the layout reads the membership from `GET /me/workspaces`; a `404` stays `notFound()`).
- i18n (fr first): `invite.title` « {inviter} vous invite à rejoindre {workspace} », `invite.mismatch` « Cette invitation est destinée à {email} », `invite.switchAccount` « Se déconnecter et continuer avec {email} », `invite.expired` (PRD verbatim), `invite.revoked` « Invitation révoquée », `invite.accepted` « Invitation déjà utilisée », `invite.join` « Rejoindre l'espace de {name} ? », `invite.guardianEmail` « Email du tuteur », `invite.guardianHint` « Vous avez moins de 18 ans : votre tuteur devra autoriser votre accès. », `pending.*`, `join.*`.

- [ ] **Step 1: Write the failing tests**

```tsx
// invitation-accept-form.test.tsx (renderWithIntl, api mocked)
it('MISMATCH shows the masked email and the switch-account button, no form', …);
it('ANONYMOUS student: the guardian email field appears only once the birth date makes a minor', …);
it('MATCH posts mode JOIN and redirects a minor to /app/w/{wid}', …);
it('a 422 on guardianEmail is shown as a field error (translated)', …);
// membership-pending-panel.test.tsx: variants; resend success toast; 429 disables the button with the minutes
// e2e/invitations.spec.ts (fr + ar projects)
test('AC-INV-01/03 UI: teacher invites via API, the emailed link opens the invite page, an anonymous adult registers and lands on /app with the workspace listed ACTIVE', …);   // Mailpit
test('AC-INV-02 UI: logged in as another user, the invite page says the invitation is for a***@… and offers to sign out; after sign-out the register form appears', …);
test('join code with approval: register, see the "demande envoyée" page; the teacher approves via API; the student sees the workspace', …);
test('AR: the invite page is dir=rtl, no raw keys', …);
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/web exec vitest run src/components/invitation-accept-form src/components/membership-pending-panel` — Expected: FAIL.
- [ ] **Step 3: Implement**; i18n keys in the three catalogues.
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/web --filter=@nibras/i18n --concurrency=2 && pnpm --filter @nibras/web e2e --project=chromium-fr --project=chromium-ar invitations` — Expected: PASS fr/ar.
- [ ] **Step 5: Commit**

```bash
git add apps/web packages/i18n && git commit -m "feat(web): public invitation and join pages with register/join/mismatch states, student waiting panel for pending consent or approval"
```

---

### Task 12: Web — guardian consent page, guardian page, minors notice placeholder (AC-INV-10, 11 UI; Review Focus 6)

Depends on T7, T11 (`(public)` layout).

**Files:**

- Create: `apps/web/src/app/[locale]/(public)/guardian-consent/[token]/page.tsx`, `(public)/guardian/[token]/page.tsx`, `apps/web/src/app/[locale]/legal/minors/page.tsx` (placeholder like `legal/terms`, « owner to provide »), `apps/web/src/components/guardian-consent-form.tsx` (+ `.test.tsx`), `apps/web/src/components/guardian-panel.tsx` (+ `.test.tsx`), `apps/web/e2e/guardian.spec.ts`
- Modify: `packages/i18n/messages/{fr,ar,en}.json` (`guardian.*`, `legal.minors.*`)

**Interfaces:**

- `/guardian-consent/[token]`: `GET /guardian-consent/{token}`; `410` → `StatusPage` (`guardian.expired` « Ce lien a expiré — demandez au professeur de renvoyer la demande », `guardian.decided`); `200` → `<GuardianConsentForm>`: heading « {student} souhaite rejoindre l'espace de {teacher} ({workspace}) », `Field`s prénom, nom, `Select` lien de parenté (`GUARDIAN_RELATIONSHIPS` → `guardian.relationship_PARENT` « Parent », `_LEGAL_GUARDIAN` « Tuteur légal », `_OTHER` « Autre »), link « Lire la notice d'information sur les mineurs » (`noticeUrl`, new tab with the sr-only cue), `Checkbox` « J'autorise {student} à utiliser l'espace de {teacher} » (required for GRANT), buttons **Autoriser** (primary, `GRANT`) and **Refuser** (secondary → `AlertDialog` « Refuser l'accès de {student} ? » → `REFUSE`); success → `StatusPage` « Merci. {student} peut maintenant utiliser l'espace de {teacher}. » with the link « Voir les sessions de {student} » (`guardianPageUrl`), or « Vous avez refusé… ».
- `/guardian/[token]`: `GET /guardian/{token}` → `<GuardianPanel>`: `PageHeader` « Sessions de {student} », `Card` consent status (`Badge` per `link.status`, dates), `EmptyState` « Aucune session planifiée pour le moment » (list rendered from `sessions` when non-empty — SP5 defines the row), actions: **Retirer mon consentement** (`AlertDialog destructive` quoting D-O5: « {student} perdra l'accès à l'espace de {teacher} uniquement ; ses autres espaces ne sont pas concernés. ») → `POST /guardian/{token}/revoke`; when `REVOKED | REFUSED` → **Autoriser à nouveau** → same form fields (`GuardianRegrant`) → `POST /guardian/{token}/grant`.

- [ ] **Step 1: Write the failing tests**

```tsx
// guardian-consent-form.test.tsx: GRANT disabled until the checkbox; REFUSE opens the confirm dialog; posts the relationship; shows a 410 as the decided page
// guardian-panel.test.tsx: ACTIVE shows the revoke action; REVOKED shows regrant; empty sessions state
// e2e/guardian.spec.ts (fr + ar)
test('AC-INV-09/10 UI: a minor registers from an invite link (birth date 15 y), the guardian email arrives (Mailpit), the consent page grants with name + relationship, the student\'s workspace becomes usable (waiting panel gone), the guardian confirmation email links to the guardian page listing no sessions yet', …);
test('AC-INV-11 UI: from the guardian page, revoke → the student sees "Consentement retiré"; re-grant → active again', …);
test('AR: consent page dir=rtl, Arabic email subject (Mailpit subject matches /[\\u0600-\\u06FF]/), no raw keys', …);
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/web exec vitest run src/components/guardian-consent-form src/components/guardian-panel` — Expected: FAIL.
- [ ] **Step 3: Implement**; i18n.
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/web --filter=@nibras/i18n --concurrency=2 && pnpm --filter @nibras/web e2e --project=chromium-fr --project=chromium-ar guardian invitations` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web packages/i18n && git commit -m "feat(web): guardian consent page (grant/refuse) and guardian page (sessions, revoke, re-grant); minors notice placeholder"
```

---

### Task 13: Web — students page: list with tabs, invite dialog, invite-link card, row actions, nav and tabs (AC-INV-01, 04, 05, 08 UI)

Depends on T4, T6, T8 (API), T11 (status helpers).

**Files:**

- Create: `apps/web/src/app/[locale]/(app)/app/w/[wid]/students/{page,loading}.tsx`, `apps/web/src/components/students-panel.tsx` (+ `.test.tsx`), `apps/web/src/components/invite-student-dialog.tsx` (+ `.test.tsx`), `apps/web/src/components/invitations-list.tsx` (+ `.test.tsx`, shared with T14's staff list), `apps/web/src/components/invite-link-card.tsx` (+ `.test.tsx`), `apps/web/e2e/students.spec.ts`
- Modify: `apps/web/src/lib/navigation.ts` (+ `.test.ts`: `workspace-{id}-students` for OWNER/ADMIN/TEACHER memberships), `apps/web/src/app/[locale]/(app)/app/w/[wid]/workspace-tabs.tsx` (Étudiants tab, role-gated through `detail.myRole`), `apps/web/src/components/onboarding-checklist.tsx` (`inviteStudents` live → `/app/w/{personalWid}/students`, `firstCourse`/`firstSession` stay _Bientôt_), `packages/i18n/messages/{fr,ar,en}.json` (`students.*`, `invitations.*`, `inviteLinks.*`, `nav.students`, `workspace.navStudents`)

**Interfaces:**

- `StudentsPanel({ wid, detail, meId })`: `PageHeader` « Mes étudiants ({count}) » (count = ACTIVE + pending rows loaded) with actions **+ Inviter** (opens `InviteStudentDialog`), **Importer CSV** (T15; renders disabled with `title` until then — remove in T15), **Lien de groupe** (toggles `InviteLinkCard`); `Tabs` `all` / `pending` (URL `?tab=`): `all` = `GET /students` (status not pending-ish), `pending` = `GET /students?status=…` for `PENDING_APPROVAL`, `PENDING_GUARDIAN_CONSENT`, `SUSPENDED_NO_CONSENT`, `SUSPENDED_CONSENT_REVOKED` merged with `GET /invitations?status=PENDING&role=STUDENT` (D8; both through `useAbortableQuery`, pending invitations rendered as rows « invitation en attente ⏳ » with `Badge warning`); search `Input` (debounced); `Table` columns Nom · Cours (« — », SP3) · Progression (« — ») · Présence (« — ») · Tuteur (`Badge` by `guardian.status` + masked/full email) · Dernière activité (« — ») · Actions; row menu (`DropdownMenu`, `aria-label={t('students.rowActions', { name })}`): **Profil** (link), **Approuver** / **Refuser** (`PENDING_APPROVAL`, `student.invite`), **Renvoyer au tuteur** (consent statuses, `student.update`), **Retirer** (`AlertDialog`, `student.remove` via `grantFor`), **Signaler** (`ReportAbuseButton`); invitation rows: **Renvoyer**, **Modifier** (names / guardian email `Dialog`), **Révoquer**. `EmptyState` « Invitez votre premier étudiant » with the **+ Inviter** action. Writes disabled on a non-ACTIVE workspace (423).
- `InviteStudentDialog`: `Field`s email, prénom (optionnel), nom (optionnel), email du tuteur (optionnel, hint « si l'élève est mineur »), date de naissance (optionnel), message (optionnel, `Textarea`); organisation ADMIN: `Select` « Affecter au professeur » from `GET /members?role=TEACHER` (+ admins with `canTeach`); submit → `POST /invitations`; `409 ALREADY_MEMBER` / `INVITATION_PENDING` as field errors on email; `403 TEACHER_NOT_VERIFIED` → `Alert` with a link to `/app/settings/verification` listing `details.missing`; success toast « Invitation envoyée à {email} » and `reload()`.
- `InviteLinkCard`: lists `GET /invite-links` (code, url with a **Copier** button using `navigator.clipboard` + toast, uses `{usesCount}/{maxUses}`, expiry, `Badge` status, approval switch label), **Créer un lien** form (libellé, nombre d'utilisations, expiration, approbation requise), **Désactiver** (`AlertDialog`).
- `InvitationsList({ wid, role: 'STUDENT' | 'STAFF', canManage })`: the table of pending/expired invitations with Renvoyer (429 → toast with minutes) / Révoquer / Modifier.
- Nav: `buildNavModel` adds the Étudiants item between the workspace settings and members items for memberships whose `role ∈ {OWNER, ADMIN, TEACHER}` (`Users` icon → members keep `Users`; students use `GraduationCap`); `WorkspaceTabs` gets `{ value: 'students', segment: '/students', label: 'workspace.navStudents' }` when `myRole` allows.

- [ ] **Step 1: Write the failing tests**

```tsx
// students-panel.test.tsx: pending tab merges members in consent statuses and PENDING invitations; row menus are named per student; approve/reject only on PENDING_APPROVAL; remove only with student.remove (org TEACHER sees none); empty state CTA
// invite-student-dialog.test.tsx: posts the normalised body; 409 INVITATION_PENDING → field error on email; TEACHER_NOT_VERIFIED → alert with the verification link
// invite-link-card.test.tsx: create with defaults; copy button writes the url; disable confirm
// navigation.test.ts: students item for OWNER/TEACHER memberships, not for STUDENT
// e2e/students.spec.ts (fr + ar)
test('AC-INV-01 UI: invite from the dialog → row "invitation en attente" in the pending tab; resend → toast; revoke → row gone', …);
test('AC-INV-08 UI: create a group link with approval, a student joins (API), the pending tab shows him, Approuver → he moves to Tous', …);
test('onboarding: "Inviter mes étudiants" links to the personal workspace students page', …);
```

- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/web exec vitest run src/components/students-panel src/components/invite-student-dialog src/components/invite-link-card src/lib/navigation` — Expected: FAIL.
- [ ] **Step 3: Implement**; i18n; `seed.ts` may add `inviteStudent(ctx, wid, email)` helpers over the API for the e2e.
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/web --filter=@nibras/i18n --concurrency=2 && pnpm --filter @nibras/web e2e --project=chromium-fr --project=chromium-ar students` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web packages/i18n && git commit -m "feat(web): students page with pending tab, invite dialog, group invite links, approval and consent actions; students nav entry and onboarding link"
```

---

### Task 14: Web — student profile skeleton, staff invitations on the members page

Depends on T13 (`InvitationsList`).

**Files:**

- Create: `apps/web/src/app/[locale]/(app)/app/w/[wid]/students/[uid]/{page,loading}.tsx`, `apps/web/src/components/student-profile-panel.tsx` (+ `.test.tsx`), `apps/web/src/components/invite-staff-dialog.tsx` (+ `.test.tsx`)
- Modify: `apps/web/src/components/members-panel.tsx` (+ `.test.tsx`: **+ Inviter un professeur / un admin** when `grantFor(grant, 'workspace.staff.manage') === 'all'` and `isOrg`; « Invitations en attente » `InvitationsList role="STAFF"`; remove the `members.noStudents` notice), `apps/web/e2e/workspaces.spec.ts` (+ staff invitation flow), `packages/i18n/messages/{fr,ar,en}.json` (`students.profile.*`, `members.inviteStaff*`; drop `members.noStudents`)

**Interfaces:**

- `StudentProfilePanel({ wid, uid, profile, grant })`: `PageHeader` with the name and status `Badge`; cards: Identité (email when present, langue, fuseau, « Mineur » badge when `isMinor`), Adhésion (statut, rejoint le, invité par, retiré le), Tuteur (email, nom, lien de parenté, statut, dates; actions **Renvoyer la demande** and **Modifier l'email** (`Dialog` → `PATCH /students/{uid}`), hidden for adults), Professeurs affectés (org), then `EmptyState`s Cours (« Disponible avec les cours — SP3 »), Sessions, Comptes rendus, Activité — each `EmptyState` names the feature, not the plan number, in the UI copy (`students.profile.coursesSoon` « Les cours attribués apparaîtront ici. »).
- `InviteStaffDialog`: email, rôle (`Select` TEACHER / ADMIN), message; `POST /invitations` with `role`; the same error mapping as the student dialog.
- e2e: replace `addOrgMember(wid, member.userId, 'TEACHER')` in `a11y.spec.ts` and `workspaces.spec.ts` with an API-driven invitation + acceptance helper `joinByInvitation(ctx, wid, user)` in `seed.ts` (`POST /workspaces/{wid}/invitations` as the owner → Mailpit link → `POST /invitations/{token}/accept` `{ mode: 'JOIN' }` as the member); keep `addOrgMember` only where a `STUDENT` must be seeded without a birth date (none expected — delete the psql helper when unused and update the SP1 ruling comment).

- [ ] **Step 1: Write the failing tests** — `student-profile-panel.test.tsx` (guardian card only for minors; empty sections present with headings; edit-email dialog posts the patch), `invite-staff-dialog.test.tsx`, `members-panel.test.tsx` (+ staff invite button gated by role and org), e2e `workspaces.spec.ts` (+ `test('an OWNER invites a teacher by email; the teacher accepts by JOIN and appears in the members list; he has no personal workspace (AC-WS-08 UI)', …)`).
- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/web exec vitest run src/components/student-profile-panel src/components/invite-staff-dialog src/components/members-panel` — Expected: FAIL.
- [ ] **Step 3: Implement**; migrate the e2e seeding to the API helper.
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/web --filter=@nibras/i18n --concurrency=2 && pnpm --filter @nibras/web e2e --project=chromium-fr --project=chromium-ar workspaces students a11y` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web packages/i18n && git commit -m "feat(web): student profile skeleton with guardian card; staff invitations on the members page; e2e seeding through invitations"
```

---

### Task 15: Web — CSV import dialog; accessibility sweep of every new page (AC-INV-07 UI; spec §8 DoD)

Depends on T10, T13.

**Files:**

- Create: `apps/web/src/components/csv-import-dialog.tsx` (+ `.test.tsx`), `apps/web/e2e/imports.spec.ts`, `apps/web/e2e/fixtures/students-100.csv` (generated by the spec at runtime instead — no fixture file; keep the directory out)
- Modify: `apps/web/src/components/students-panel.tsx` (enable **Importer CSV**), `apps/web/e2e/a11y.spec.ts` (+ students page, student profile, invite page, join page, guardian-consent page, guardian page — in `chromium-fr`, `chromium-ar`, `mobile-ar` via the existing `testMatch`), `packages/i18n/messages/{fr,ar,en}.json` (`imports.*`)

**Interfaces:**

- `CsvImportDialog({ wid, onDone })`: step 1 — `<input type="file" accept=".csv,text/csv">` (`Field` with the column list hint « email (obligatoire), first_name, last_name, guardian_email, birth_date, course_codes ») and a **Télécharger le modèle** link (`data:` URL with the header line); file read with `FileReader` (`readAsText`), `> IMPORT_MAX_BYTES` → inline error; **Prévisualiser** → `POST …/import?dryRun=true`; step 2 — summary « {valid} lignes valides · {invalid} en erreur » + `Table` of the rows with `Badge` outcomes (filter « Erreurs seulement »), **Importer {valid} invitations** → `POST …/import` → step 3 — progress (`role="progressbar"`, polling `GET …/import/{id}` every 2 s through `useAbortableQuery` with a `tick` key until `COMPLETED | FAILED`), then counts and **Télécharger le rapport** (anchor to `…/import/{id}/report`, `download`); `409 IMPORT_IN_PROGRESS` → `Alert` with the running import's progress.
- a11y: `audit(page, testInfo, 'students')`, `'student-profile'`, `'invite'`, `'join'`, `'guardian-consent'`, `'guardian'` — the public pages are reached with tokens produced by API seeding inside the test; serious/critical = 0 in fr, ar and mobile-ar; screenshots captured for the RTL recette.

- [ ] **Step 1: Write the failing tests** — `csv-import-dialog.test.tsx` (oversized file blocked client-side; preview table with outcomes; confirm posts; progress polls until COMPLETED and shows the report link); e2e `imports.spec.ts` (`test('AC-INV-07 UI: a generated 100-row CSV with 3 invalid emails and 2 duplicates → preview flags 5, import runs (worker), 95 invitations in the pending tab, report downloads with 100 lines', …)`); `a11y.spec.ts` additions.
- [ ] **Step 2: Run the tests to verify they fail** — Run: `pnpm --filter @nibras/web exec vitest run src/components/csv-import-dialog` — Expected: FAIL.
- [ ] **Step 3: Implement**; i18n.
- [ ] **Step 4: Run the tests to verify they pass** — Run: `pnpm turbo run lint typecheck test --filter=@nibras/web --filter=@nibras/i18n --concurrency=2 && pnpm --filter @nibras/web e2e --project=chromium-fr --project=chromium-ar --project=mobile-ar imports a11y && pnpm --filter @nibras/web build && pnpm --filter @nibras/web budget` — Expected: PASS; every route under the 250 kB first-load budget (the students page pulls `@nibras/contracts/web` only).
- [ ] **Step 5: Commit**

```bash
git add apps/web packages/i18n && git commit -m "feat(web): csv student import with preview, progress and report; axe coverage of the sp2 pages in fr, ar and mobile-ar"
```

---

### Task 16: Final sweep — runbook, spec status, OpenAPI drift, full verification, FIX-LATER

Depends on everything.

**Files:**

- Create: `docs/runbooks/students-and-invitations.md` (one page: invitation lifecycle and cooldowns, token rules, consent lifecycle (statuses × membership statuses table, resend, expiry job, revoke/re-grant), the `/me/workspaces/:wid/guardian/*` deliberate non-tenant route, invite codes and the attempt limiter, CSV import (format, limits, report, retry semantics), audit actions added, events for SP5/SP6, what SP3/SP4/SP5/SP6/SP7 fill (`courseIds`, columns, `sessions`, in-app notifications), troubleshooting (a stuck import, a guardian who lost the link → teacher resends consent; a re-granted guardian link))
- Modify: `docs/runbooks/auth-and-tenancy.md` (audit actions table + jobs table + the isolation note on `GUARDIAN_CONSENT_REQUIRED`), `docs/superpowers/specs/2026-10-18-sp2-students-invitations-design.md` (Status → Implemented; §12 "Implementation notes and deviations" from the commit bodies; owner questions still open with their defaults), `PRD.md` only if a decision contradicts it (expected: none — the `REFUSED` enum value and the single guardian token are recorded in the spec as planner additions)

- [ ] **Step 1: Run everything** — `pnpm turbo run lint typecheck test build --concurrency=2 && pnpm format:check && pnpm --filter @nibras/db migrate:check && pnpm audit --prod --audit-level=high && pnpm --filter @nibras/api openapi:export && pnpm --filter @nibras/contracts generate && git diff --exit-code packages/contracts && pnpm --filter @nibras/web e2e && pnpm --filter @nibras/web build && E2E_PROD=1 pnpm --filter @nibras/web e2e` — Expected: all PASS.
- [ ] **Step 2: Write the runbook and the spec notes**; list FIX-LATER items found during the plan (candidates: Idempotency-Key for invitation creation (SP5), guardian link expiry (Q5), per-workspace display name (Q1), SP5/SP6 reaction to the worker-side consent expiry (no in-process event from the worker — they will enqueue a `sessions` job from the expiry processor)).
- [ ] **Step 3: Commit**

```bash
git add docs && git commit -m "docs: students and invitations runbook, sp2 spec status and deviations; sp2 closed"
```

---

## Parallel groups

Not applicable while the disk constraint holds (SP1.6 spec Q5): execute **T0 → T16 in order in the main checkout**. For review only, the dependency graph is: T0 → T1 → T3 → T4 → T5 → T6 → T7 → T8; T2 after T0 (used from T4); T9 after T1 + T2; T10 after T4 + T9; T11 after T5–T7; T12 after T7 + T11; T13 after T8 + T11; T14 after T13; T15 after T10 + T13; T16 last. Should disk allow it later, `{T2, T9}` can run beside `{T4 … T8}` and `{T11, T12}` beside `{T13, T14}` (at most two implementers, no page file).

## Self-review notes (performed while writing)

- **Every DoD item has an owning task:** AC-INV-01 → T4/T13; 02 → T5/T11; 03 → T5/T11; 04 → T4/T13; 05 → T4/T13; 06 → T4; 07 → T10/T15; 08 → T6/T13; 09 → T3/T5/T12; 10 → T7/T12; 11 → T7/T12; 12 → T9; 13 → T5; AC-SAFE-06 → T7 (+ T12 page); emails naming workspace and teacher → T2 (asserted); consent expiry job per workspace without purge → T9 (asserted: no user/consent/other-membership change). Design decisions D1–D12 are realised in T4, T5/T6, T4/T5/T7, T1/T7, T6, T7, T3, T8/T13, T10, T10, T8, T7 respectively.
- **Consumed names checked against the SP1.6 branch as read on 2026-10-18:** `MembershipService.addMember(input, tx)` overloads, `MembersService.ownScope` (private → opened in T8), `WorkspaceContextGuard` status branches, `isPublicRequest`, `AccountGatesGuard` order, `hitWindow`/`rateLimited`, `EmailVerificationService.newToken/send`, `SessionService.createSession` + `setAuthCookies`, `RegisterService.registerTeacher` transaction (extracted in T5), `crossTenantDb` filter rule (`hasUserOrIdFilter`, extended in T1 and T7), RLS policy text (`NULLIF` form), `QueueRegistry.queues` + bullmq 5.81.5 (`upsertJobScheduler`), `AbuseProcessor` progress pattern, `InMemoryEmailProvider.failFor` (SP1.6 T7), isolation fixture tables (SP1.6 T6), `buildNavModel` shape, `WorkspaceTabs`, `OnboardingChecklist` items, `MembersPanel` role gating, e2e `seedUser`/`addOrgMember`/Mailpit helpers, Playwright projects.
- **Known tensions:** (1) `GUARDIAN_CONSENT_REQUIRED` changes a code the SP1.6 isolation suite asserts — T3 updates that scenario in the same commit; (2) the CSV worker duplicates the two "already member / already invited" checks of the API (two queries) rather than importing API code — accepted, documented in the runbook; (3) inline emails on public routes make a slow SMTP relay stretch the accept request (bounded by the provider timeout) — SP7 moves delivery to `NotificationDelivery` without touching the templates; (4) the `(public)` route group must not inherit the `(auth)` redirect of signed-in users — T11 verifies `proxy.ts` and the layouts; (5) `app.useBodyParser('json', { limit: '1mb' })` raises the limit for every route, not just the import — accepted (zod caps every other body far below that); (6) the worker-side consent expiry cannot emit the in-process `MembershipDeactivatedEvent` — SP5/SP6 add a job-based reaction, recorded as FIX-LATER in T16.
- **Proportion:** 17 tasks (T0–T16), each one implementer; the largest (T5, T7, T13) stay within one module each; no task touches more than two apps except T10 (api + worker, by nature of a queued import).
