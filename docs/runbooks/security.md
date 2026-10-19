# Security

One-page map of the platform's security rules (SP1.6, audit follow-up; spec
`docs/superpowers/specs/2026-10-17-sp1.6-security-hardening-design.md`). Each section states the
rule and links to the runbook that holds the procedure; the details are not repeated here.

## Hosting

Staging runs today on a **local machine** (single Docker host, `infra/compose.staging.yml`); the
production target is **OVHcloud**. The same rules apply to both: per-service environment and
read-only containers (below), images verified and scanned before they reach GHCR, and the deploy
job pinning the host's SSH key (`STAGING_SSH_FINGERPRINT`; the procedure to obtain it is the same
for both hosts). TLS terminates on a reverse proxy on the host ([staging.md](staging.md)).

## Secrets and placeholder values (F6)

Outside development (`APP_ENV=staging|production`) the API and the worker refuse to start when:

- `JWT_SECRET` or `TOTP_ENCRYPTION_KEY` is one of the values committed to the repository
  (`PLACEHOLDER_SECRETS` in `packages/contracts/src/env-placeholders.ts`: `.env.example`, CI, test
  fixtures) or looks like one (`dev-only…`, `ci-only…`, `test-only…`, `change-me`);
- `JWT_SECRET` has fewer than 3 character classes (generate it with `openssl rand -base64 48`);
- `DATABASE_URL` / `DATABASE_URL_SYSTEM` use the `init.sql` development password `app`;
- `COOKIE_SECURE` is not `true`, or `WEB_ORIGIN` is not `https:`.

The error names the variable and the command that generates a real value. `HIBP_ENABLED` is a free
choice in every tier, including production (owner Q2): no startup rule. Rotation of `JWT_SECRET`
and `TOTP_ENCRYPTION_KEY`: [auth-and-tenancy.md](auth-and-tenancy.md).

## Super-admin bootstrap (F2)

`create-super-admin` creates a new account by default. Promoting an existing account needs
`--promote-existing`, an `ACTIVE` account, an email **already** verified (the CLI never verifies
one) and the account's current password; otherwise it exits 1 and writes nothing. Pass the
password with `--password-stdin`. The operator must prove **their own** password: never promote
an account you did not create yourself. Procedure: [auth-and-tenancy.md](auth-and-tenancy.md#creating-the-first-super-admin).

## Who sees an abuse reporter (F1, owner Q1)

Super-admins only, in `/admin/abuse-reports` (`AdminAbuseReportSchema`). Organisation OWNER/ADMIN
handlers get reports without any `reporter` key; the `abuse_report.created` audit row has no
reporter id and a hidden actor; `AuditService` drops `NEVER_AUDITED_KEYS` (`reporterUserId`,
`reporter`) from every audit row; the `abuse.new_report` email names nobody. The reporter sees
their own reports through `GET /me/abuse-reports`. Details:
[auth-and-tenancy.md](auth-and-tenancy.md#abuse-reports-who-sees-the-reporter).

## Step-up on 2FA (F5)

`POST /auth/2fa/setup` takes `{ password }`, `POST /auth/2fa/disable` takes `{ otpCode, password }`.
A wrong password is `401 INVALID_CREDENTIALS` with an `auth.reauth_failed { purpose }` audit row;
the count is shared with password and email change (`ReauthLimiter`: more than 5 in 15 min →
`429`). The setup confirmation (`POST /auth/2fa/verify`) only confirms a seed created by a
password-checked setup. Table: [auth-and-tenancy.md](auth-and-tenancy.md#rate-limits).

## Ownership invariant (F7)

Exactly one `OWNER` membership per workspace, `ACTIVE`, equal to `workspace.owner_user_id`. The
partial unique index `membership_owner_per_workspace_key` refuses a second OWNER; transfers lock the
workspace and both membership rows and demote before promoting; member updates and removals are
conditional on the role they read. Details: [auth-and-tenancy.md](auth-and-tenancy.md#one-owner-per-workspace).

## Tenant isolation suite (F8)

`apps/api/test/isolation/` enumerates every `/workspaces/{wid}` and `/admin/**` route from the
router and probes: non-members (`404`), an ACTIVE member of A with B's real ids in path params,
cursors and bodies (`404` / `422`, never `2xx`), inactive memberships (`403 MEMBERSHIP_INACTIVE`),
`SUSPENDED`/`DELETING` workspaces (`423` on every write) and the platform console (`403` for an
org OWNER). The fixture tables (`FOREIGN_PARAMS`, `FOREIGN_QUERIES`, `FOREIGN_BODIES`,
`BODYLESS_WRITE_ROUTES`) are the review surface: a new route without an entry fails the suite.
Details: [auth-and-tenancy.md](auth-and-tenancy.md#tenant-isolation-suite).

## Notification jobs (F12)

Creating an abuse report enqueues one `abuse.report_created { reportId }` job on `notifications`
(`jobId abuse:{id}:notify`, 5 attempts, exponential backoff); the worker sends the acknowledgement
and the handlers' emails sequentially and records `sentTo` in the job progress, so a retry never
emails anyone twice. A failed enqueue is logged with the report id; the request still succeeds.

## Per-service environment and read-only containers (F3)

On the staging host `.env.staging` (mode `600`) is used for compose interpolation only. Each
service receives only its own variables: `migrate` the BYPASSRLS `DATABASE_URL_SYSTEM`, the api the
RLS `DATABASE_URL` and the auth secrets (never `DATABASE_URL_SYSTEM`), the worker
`DATABASE_URL_SYSTEM` without auth secrets, the web **no secret at all**. App containers run
`read_only` with tmpfs `/tmp` (+ the web's `.next/cache`), `cap_drop: [ALL]`,
`no-new-privileges`, `init`. `packages/config/infra/compose-staging.test.ts` enforces the
allocation. Table: [staging.md](staging.md).

## Images (F11)

api/worker images carry production dependencies only (no sources, tests, TypeScript, vitest,
eslint, Nest CLI, swc); no runtime image carries a package manager (`npm`, `npx`, `corepack`,
`yarn` deleted). All run as uid 1001. `infra/docker/verify-image.sh <image> <api|worker|web>` is
the gate CI runs before pushing, followed by `trivy image`. Usage and sizes:
[local-dev.md](local-dev.md#container-images).

## Deploy pinning and Dependabot (F4, owner Q4)

Every `uses:` in `.github/workflows/*.yml` is pinned to a commit SHA with a `# vX.Y.Z` comment
(`packages/config/infra/workflows.test.ts`). The deploy job verifies the host key with
`STAGING_SSH_FINGERPRINT`; the secret is **optional for now**: while it is absent the deploy job
skips with a notice naming it, it never deploys without it. Add it before the next real deploy.
Dependabot (`.github/dependabot.yml`) bumps actions, npm (minor/patch grouped, framework majors
ignored) and the Docker base images weekly. Procedure: [staging.md](staging.md#host-key-fingerprint-staging_ssh_fingerprint).

## Scanners and allow-lists (F9, F10, owner Q3)

`.github/workflows/security.yml` (PRs, pushes to `main`, weekly): `pnpm audit --prod
--audit-level=high` (blocking), dependency review (PRs, high+), CodeQL (javascript-typescript),
gitleaks (`gitleaks-action` with `GITHUB_TOKEN` only — free on the personal repository
`github.com/smayros-dev/nibras`, no licence, no fallback job), trivy config on `infra/`,
actionlint. `ci.yml`'s `images` job adds `trivy image` before the push. nodemailer is on 10.1.2.
Every allow-list entry (`pnpm.auditConfig.ignoreGhsas`, `.trivyignore`, `.gitleaks.toml`) carries a
written reason and what removes it; today only `deepmerge-ts` (via Prisma 6, removed by Prisma 7).
A real secret is never allow-listed: rotate it. Table and local pre-push commands:
[local-dev.md](local-dev.md#security-scans).

## GitHub settings the owner must enable

Repository settings, not controlled by the code:

| Setting                                          | Where                                      | Why                                                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGING_SSH_FINGERPRINT` secret                 | Settings > Secrets and variables > Actions | The deploy job skips until it is set ([staging.md](staging.md#host-key-fingerprint-staging_ssh_fingerprint))                                                                 |
| Dependency graph                                 | Settings > Code security                   | Required by `dependency-review` and Dependabot alerts                                                                                                                        |
| Dependabot alerts (and security updates)         | Settings > Code security                   | Advisories on the lockfile between weekly runs; `dependabot.yml` only configures version updates                                                                             |
| Code scanning: CodeQL **default setup OFF**      | Settings > Code security > Code scanning   | `security.yml` runs CodeQL as an advanced setup; GitHub refuses SARIF uploads from a workflow while default setup is on                                                      |
| Secret scanning + push protection                | Settings > Code security                   | GitHub-side detection and blocking at push time, in addition to gitleaks                                                                                                     |
| Branch protection on `main` with required checks | Settings > Branches (or Rules)             | Require `check`, `windows-check`, `migrate-check`, `e2e` (CI) and the `security.yml` jobs (`audit`, `dependency-review`, `codeql`, `gitleaks`, `trivy-config`, `actionlint`) |

## Follow-ups (out of SP1.6)

- `Origin` / `Sec-Fetch-Site` check on mutations (CSRF defence in depth; `SameSite=Lax` + CORS
  already cover it).
- Prisma 7 upgrade (removes the `deepmerge-ts` allow-list entries).
- Branch protection / required checks (owner action, table above).
- `auth_time`-based step-up for other sensitive actions (account deletion, SP11).
