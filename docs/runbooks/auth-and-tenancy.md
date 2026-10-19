# Auth, tenancy & RBAC (SP1)

Operational runbook for the SP1 slice: registration/login, 2FA, consents, workspaces, the
super-admin console, audit actions and rate limits. Local dev setup lives in
[local-dev.md](local-dev.md); the security rules across sub-projects are summarised in
[security.md](security.md).

## Creating the first super-admin

There is no self-serve super-admin signup. Bootstrap one with the CLI. By default it **creates** a
new account (ACTIVE, email verified, the password policy applies, `SUPER_ADMIN`). Pass the
password on stdin so it stays out of the shell history and `ps`:

```bash
printf '%s' "$PW" | pnpm --filter @nibras/api cli create-super-admin --email ops@example.com --password-stdin
```

`--password '<a long password>'` still works (local dev, CI), but it is visible to other users of
the host. The two forms are mutually exclusive; with `--password-stdin` one trailing newline is
dropped.

**Promoting an existing account** is refused unless all four conditions hold, checked in this
order (exit code 1 with the reason otherwise; nothing is written):

1. `--promote-existing` is passed (without it the CLI stops with a hint, even for an account that
   is already a super-admin);
2. the account is `ACTIVE`;
3. its email is already verified — the CLI never marks an email verified;
4. it has a password and the `--password` / `--password-stdin` given verifies against it.

The password and names of a promoted account are kept; missing required consents are granted and
every run (creation or promotion) is audited as `user.super_admin_granted` (`after.created`
`true`/`false`). A re-run with `--promote-existing` on an existing super-admin is idempotent.

> **Warning — prove _your own_ password.** These checks stop an attacker who pre-registered the
> operator's email from being promoted, but they cannot tell whether the account's current
> password is really yours: an account whose email was verified by its owner and then taken over
> verifies the attacker's password just as well. Only promote an account you created and whose
> password you set yourself. If the account was not created by you (or you are unsure), delete it
> first and let the CLI create a fresh one.

The CLI grants the static `CONSENT_VERSIONS` TERMS version. If the deployment runs with a bumped
`TEST_CONSENT_TERMS_VERSION` (the e2e suite does), the account must re-accept that version before
the API lets it through the consent gate.

The e2e suite does this automatically: Playwright's `globalSetup` (`apps/web/e2e/warmup.ts`) seeds
a throwaway super-admin and exposes `E2E_SUPER_ADMIN_{EMAIL,PASSWORD,TOTP_SECRET}` to the tests.
It promotes its own freshly registered, verified account with `--promote-existing` and the
password it registered with. No CI step is needed — `pnpm build` provides the CLI dist the
globalSetup runs.

## Rotating `JWT_SECRET`

Invalidates **all** sessions and refresh tokens (access token 15 min, refresh token 30 days are
signed with it). Generate a new 48-byte base64 value (`openssl rand -base64 48`), update the env,
restart the API and the worker. Users must log in again; nothing else is lost.

## Rotating `TOTP_ENCRYPTION_KEY`

TOTP seeds are sealed at rest with AES-256-GCM (`SecretBox`) keyed by this 32-byte base64 value.
Changing the key **without** re-sealing every stored seed breaks 2FA for every enrolled user
(their codes stop verifying and the seeds cannot be decrypted).

There is no re-seal command yet: write a one-shot migration script when first needed. It must, in
one transaction per user, decrypt each `User.totpSecret` with the old key, re-encrypt with the new
one, and swap. Until such a script exists, treat this key as non-rotatable in production and
restrict access to it accordingly.

Recovery codes are stored hashed (not sealed), so they survive a rotation.

## Unlocking a locked account

Ten failed logins for one email within 15 minutes lock it for 15 minutes (`auth.account_locked`
in the audit log); the first five failures per ip+email start an exponential backoff.
The lock and the failure counter live in Redis, keyed by `sha256(email)`:

```
login:lock:<sha256(lowercased email)>    # the 15-minute lock
login:fail:<sha256(lowercased email)>    # the failure counter
```

To unlock early, delete both keys (e.g. with `redis-cli DEL ...`). The hash makes the keys
unreadable as emails; compute it with
`node -e "console.log(require('crypto').createHash('sha256').update('user@example.com').digest('hex'))"`.

## Reading OTP and other emails in dev

Every email lands in Mailpit (http://localhost:8025):

- **verify-email** — the link the e2e and humans click to verify the address.
- **phone.otp_dev** — outside the `production` tier, the phone OTP is also emailed so dev and e2e
  can read it without an SMS provider (`SMS_PROVIDER=console` logs the SMS instead). Subject per
  locale: FR « Votre code de vérification du téléphone (développement) », AR « رمز التحقق من
  هاتفك (بيئة التطوير) ».
- Password reset, email-change and other transactional templates.

## Audit actions

Every mutation writes an `AuditLog` row (`action`, actor, entity, before/after JSON) through
`AuditService.log`. Actions (SP1, `apps/api/src/audit/audit.service.ts`):

| Prefix           | Meaning                                                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.*`         | registration, login (and failures/lock), refresh-token reuse, sessions revoked, password/email changes and resets, 2FA recovery code used, failed password step-up (`auth.reauth_failed`), forbidden-workspace attempt |
| `user.*`         | profile updated, suspended/unsuspended, super-admin granted                                                                                                                                                            |
| `phone.*`        | phone verified (OTP)                                                                                                                                                                                                   |
| `consent.*`      | TERMS/PRIVACY/CODE_OF_CONDUCT granted or revoked                                                                                                                                                                       |
| `workspace.*`    | created, updated, settings updated, ownership transferred, suspended/unsuspended, deleted, quota changed                                                                                                               |
| `member.*`       | added, removed, role changed                                                                                                                                                                                           |
| `assignment.*`   | course/session assignment created or deleted                                                                                                                                                                           |
| `abuse_report.*` | report created or updated (status/resolution)                                                                                                                                                                          |

Writes are fire-and-forget: a failed audit write increments `audit_write_failures_total` and
never blocks the business operation.

After `abuse_report.created`, the API enqueues one `abuse.report_created { reportId }` job on
`notifications` (`jobId = abuse:{id}:notify`, 5 attempts, exponential backoff; SP1.6 F12) instead
of emailing inline. The worker (`AbuseProcessor.reportCreated`) sends the acknowledgement to the
reporter, then `abuse.new_report` to the handlers, one by one; the users already emailed are kept
in the job progress (`sentTo`), so a retry only reaches the ones that failed. A failed enqueue is
logged (`abuse report notifications not enqueued`, with the report id) and the request still
succeeds: the report is in the super-admin queue. A job that exhausted its attempts stays in
BullMQ's failed set (`removeOnFail: 5000`) with the worker's `job failed` log lines.

## Tenant isolation suite

`apps/api/test/isolation/tenant-routes.e2e-spec.ts` enumerates **every** `/workspaces/{wid}`
route from the app's router (`listRoutes`), so a new tenant route is covered automatically. Each
scenario loops over that list:

| Scenario                        | Caller                                                               | Expected                                                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-member (SP1)                | a TEACHER of another organisation; a user with no membership         | `404 NOT_FOUND` on every route (+ `auth.forbidden_workspace` audit)                                                                                  |
| Foreign path params and cursors | ACTIVE OWNER of A, with B's real ids                                 | `404 NOT_FOUND` for every route with a param other than `:wid`; `422 VALIDATION_FAILED` on `cursor` for the cursor listings; no B id in any response |
| Foreign bodies                  | ACTIVE OWNER of A, bodies naming B's users/rows                      | never `2xx` (and never `5xx`); no new assignment, report or membership; no row of A references a B id                                                |
| Inactive membership             | `PENDING_APPROVAL` TEACHER, `SUSPENDED_CONSENT_REVOKED` STUDENT of A | `403 MEMBERSHIP_INACTIVE` on every route                                                                                                             |
| Read-only states                | ACTIVE OWNER of a `SUSPENDED` / `DELETING` A                         | `423 WORKSPACE_SUSPENDED` on every write route; `200` on every read, abuse-report responses without any reporter (owner Q1)                          |

`apps/api/test/isolation/admin-routes.e2e-spec.ts` enumerates every `/admin/**` route: an ACTIVE
organisation OWNER (2FA on) gets `403 PERMISSION_DENIED` (no 404 masking: the console's existence
is public), a super-admin never gets `403` nor a `5xx`.

The ids come from `apps/api/test/isolation/fixtures.ts`: `createTenantPair()` builds two
organisations A and B with **disjoint** users and one report, assignment and audit row each, so
an id of B exists only in B. Its tables are the review surface:

- `PARAMS` → `FOREIGN_PARAMS` / `LOCAL_PARAMS`: path param (`':uid'`, or `'<resource>/:id'` when
  ambiguous; longest match wins) → the tenant's row.
- `FOREIGN_QUERIES`: `GET` listings whose `cursor` names a row (audit log, abuse reports,
  members). `GET …/assignments` is deliberately absent: its keyset `id > cursor` inside the
  workspace only positions the scan over A's rows.
- `FOREIGN_BODIES`: write routes with id-bearing bodies, the body naming B's ids and whether the
  path takes A's own ids (`local`, so the body is what is probed) or B's (`foreign`).
- `BODYLESS_WRITE_ROUTES`: write routes reviewed as carrying no id in their body, one comment each.

A new route whose param, cursor or id-bearing body has no entry fails the suite with "add a …
fixture"; add the fixture, never skip the route.

`apps/api/test/isolation/exemptions.ts` lists the rare routes the suite must NOT probe (e.g. ones
that intentionally answer for non-members). An exemption hides a route from **every** scenario
above, so each entry needs a comment justifying it and code review — never add one to make a
failing test pass.

## One OWNER per workspace

Every workspace has exactly one `OWNER` membership, it is `ACTIVE`, and `workspace.owner_user_id`
is its user (SP1.6 F7). The database enforces "at most one" with the partial unique index
`membership_owner_per_workspace_key` (`membership(workspace_id) WHERE role = 'OWNER'`, any status;
migration `one_owner_per_workspace`, which refuses to run if existing data already has two
OWNERs — fix those rows by hand first). The API keeps the rest: `transferOwnership` locks the
workspace row and both membership rows (`lockWorkspace`, `lockMemberships`), re-reads them under
the locks, demotes the caller **then** promotes the target in one transaction; member role
changes and removals are conditional updates on the role and status they read, so a membership
promoted to OWNER concurrently answers `404` instead of being changed or removed. The tests use
`expectOneOwner` (`apps/api/test/helpers/invariants.ts`); the races live in
`apps/api/test/workspaces/ownership-races.e2e-spec.ts`. The demo seed demotes a transferred OWNER
of the demo organisation before restoring Amine as OWNER.

## Rate limits

Global API limits are configured by env (`apps/api/src/config/env.ts`, applied by
`RateLimitModule`):

| Variable          | Default | Scope                            |
| ----------------- | ------- | -------------------------------- |
| `RATE_LIMIT_ANON` | 60/min  | per-IP, unauthenticated requests |
| `RATE_LIMIT_USER` | 600/min | per-user, authenticated requests |

Separately, the login throttle (Redis `login:fail:*` / `login:lock:*`) bounds password guessing,
and the phone OTP endpoint has its own request window (1/60 s) and attempt cap (5).

Signed-in routes that re-check the password share one per-user limiter (`ReauthLimiter`, Redis
`auth:reauth-attempts:{userId}`): more than 5 attempts in 15 min → `429 RATE_LIMITED`, a right
password resets the count.

| Route                    | Re-checks                                   | Wrong password                                                                         |
| ------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `PATCH /me/password`     | `currentPassword`                           | `401 INVALID_CREDENTIALS`, `auth.password_change_failed`                               |
| `POST /me/email-change`  | `password`                                  | `401 INVALID_CREDENTIALS`, `auth.email_change_failed`                                  |
| `POST /auth/2fa/setup`   | `password` (step-up, SP1.6)                 | `401 INVALID_CREDENTIALS`, `auth.reauth_failed { purpose: '2fa_setup' }`; no seed      |
| `POST /auth/2fa/disable` | `password`, then `otpCode` (step-up, SP1.6) | `401 INVALID_CREDENTIALS`, `auth.reauth_failed { purpose: '2fa_disable' }`; TOTP stays |

The TOTP code checked by signed-in routes (setup confirmation, disable) has its own count
(`auth:2fa-attempts:{userId}`, same 5 per 15 min).

## Super-admin console

`/{locale}/admin` (workspaces, abuse reports, health) is gated by `platformRole === 'SUPER_ADMIN'`
server-side; everyone else gets 404. Workspace suspend/unsuspend and abuse-report resolution are
audited (`workspace.suspended`, `abuse_report.updated`) and refuse to operate on deleted
workspaces.

## Abuse reports: who sees the reporter

AC-SAFE-02, owner ruling Q1 (SP1.6): the reporter's identity is shown to **super-admins only**,
in the `/admin/abuse-reports` console (`AdminAbuseReportSchema`, with `reporter`). Organisation
OWNER/ADMIN handlers never learn who filed a report:

- `GET /workspaces/{wid}/abuse-reports`, `GET`/`PATCH …/{id}` return `AbuseReportSchema`, which
  has no `reporter` key at all (not `null`);
- the `abuse_report.created` audit row carries `{ category, status, entityType, entityId }` only
  and is written with a hidden actor (`actorUserId`, `ip`, `userAgent` null, `actorRole`
  `ANONYMOUS`), since `GET /workspaces/{wid}/audit-log` is readable by the same handlers;
  `AuditService` drops the keys in `NEVER_AUDITED_KEYS` (`reporterUserId`, `reporter`, any
  depth) from every `before`/`after`;
- the `abuse.new_report` email names nobody.

The reporter still sees their own reports through `GET /me/abuse-reports` (no identity field).
