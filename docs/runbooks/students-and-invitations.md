# Students, invitations and guardian consent (SP2)

How students (often minors) and staff get into a workspace, how parental consent works per
workspace, and what to do when it goes wrong. Spec:
`docs/superpowers/specs/2026-10-18-sp2-students-invitations-design.md`. Code: `apps/api/src/`
`invitations`, `invite-links`, `guardian`, `students`, `imports`; `apps/worker/src/processors/`
`imports.processor.ts`, `expiry.processor.ts`; constants in `packages/contracts/src/invite-constants.ts`
and `queues.ts`.

## Email invitations (students and organisation staff)

| Rule             | Value                                                                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token            | 32 random bytes, base64url in the link `/{locale}/invite/{raw}`, SHA-256 hex in `invitation.token_hash`; never stored raw, logged, audited or put in a job payload                       |
| Lifetime         | 7 days (`INVITATION_TTL_MS`); a stored `PENDING` past `expiresAt` is served as `EXPIRED`; the daily job flips the stored value                                                           |
| One per address  | partial unique index `invitation_pending_per_email_key` (workspace, email) `WHERE status = 'PENDING'` → `409 INVITATION_PENDING`                                                         |
| Already a member | any membership but `REMOVED` / `REJECTED` → `409 ALREADY_MEMBER`, no row, no email (AC-INV-06)                                                                                           |
| Resend           | from `PENDING` / `EXPIRED`; 1 per 10 min per row (`429 RATE_LIMITED`, `details.retryAfterS`); new token (the old link answers `410 TOKEN_INVALID`), `expiresAt` + 7 d, `resentCount + 1` |
| Revoke           | `DELETE …/invitations/{id}` → `REVOKED`; the link answers `410 INVITATION_REVOKED`                                                                                                       |
| Email binding    | signed in as another address → `403 INVITATION_EMAIL_MISMATCH`; anonymous `REGISTER` for an existing account → `409 EMAIL_TAKEN` (the page offers « Se connecter »)                      |
| Account created  | **verified** (the link proves the mailbox, D2); staff accepted this way get no personal workspace and are sent to `/app/settings/verification`                                           |
| Staff (D1)       | `role` TEACHER / ADMIN only in an ORGANIZATION and with `workspace.staff.manage` = all, else `422 INVITATION_ROLE_NOT_ALLOWED`                                                           |
| Sending          | inline from the API (the link is a secret, D3); a failed send is logged and « Renvoyer » covers it                                                                                       |

A `REJECTED` student (owner decision, T7) is reactivated by a new email invitation like a
`REMOVED` one; re-joining by group code stays `409 ALREADY_MEMBER`.

## Group codes (`InviteLink`)

8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, stored upper-case, link `/{locale}/join/{code}`.
Defaults: `maxUses` 50 (1–1000), expiry 30 days (≤ 365), `requiresApproval` = organisation.
`DELETE` = `DISABLED` (rows kept). The use counter is incremented under the link's row lock;
reaching `maxUses` → `EXHAUSTED`. Answers: `410 INVITE_LINK_EXHAUSTED | INVITE_LINK_EXPIRED |
INVITE_LINK_DISABLED`, unknown `404`. A code-created account is **unverified** (`EMAIL_VERIFY`
email, D2). With approval: `PENDING_APPROVAL` → `POST …/members/{uid}/approve | reject`
(`409 MEMBERSHIP_NOT_PENDING` otherwise); a minor's guardian is emailed **at approval** (D5) — the
address waits on a token-less `PENDING` guardian link.

## Public token routes and the attempt limiter

`/invitations/{token}`, `/join/{code}` (`@OptionalAuth()`), `/guardian-consent/{token}`,
`/guardian/{token}` (`@Public()`) resolve the workspace by a unique secret column
(`CROSS_TENANT_LOOKUP_KEYS` in `packages/db/src/tenant.ts`), then write under `withTenantTx(wid)`.
`TokenAttemptLimiter` counts **failed** lookups per IP and scope (`invite`, `join`, `guardian`):
10 per 60 s (`TOKEN_ATTEMPTS_PER_MIN`) → `429 RATE_LIMITED` with `details.retryAfterS`, on top of
the anonymous 60 req/min. Redis keys `token-attempt:{scope}:{ip}`; to unblock an IP during an
incident, `DEL` the key. The request logger masks `/join/{code}`.

## Guardian consent (minors, per workspace)

A student under 18 (`isMinor(birthDate)`) never has an `ACTIVE` membership without an unrevoked
`Consent GUARDIAN_PARENTAL` **for that workspace** (`GuardianLink` unique per (student,
workspace); a second workspace restarts the cycle, AC-INV-13).

| Event                                | `GuardianLink`                                          | Membership                                                   | Consent row                         |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------- |
| invitation / code accepted (minor)   | `PENDING`, consent token 14 d                           | `PENDING_GUARDIAN_CONSENT` (or `PENDING_APPROVAL` first, D5) | —                                   |
| guardian grants                      | `ACTIVE`, consent token cleared, guardian-page token    | → `ACTIVE`                                                   | new, ip / user agent / version      |
| guardian refuses                     | `REFUSED` (D4)                                          | → `SUSPENDED_NO_CONSENT`                                     | none written                        |
| 14 days without decision (daily job) | stays `PENDING`, token cleared                          | `PENDING_GUARDIAN_CONSENT` → `SUSPENDED_NO_CONSENT`          | —                                   |
| guardian revokes (guardian page)     | `REVOKED`                                               | → `SUSPENDED_CONSENT_REVOKED` (this workspace only)          | `revokedAt` set                     |
| guardian re-grants (guardian page)   | `ACTIVE`, **new** guardian-page token                   | → `ACTIVE`                                                   | new row (the old one stays revoked) |
| resend (teacher or student)          | → `PENDING`, new 14-day token, `consentResentCount + 1` | unchanged until the guardian decides                         | —                                   |

- Resend: `POST /workspaces/{wid}/students/{uid}/guardian/resend-consent` (`student.update`,
  verified teacher) or the student's own `POST /me/workspaces/{wid}/guardian/resend-consent`;
  only for the three waiting statuses, 1 per 10 min (`429`), refused for an `ACTIVE` link.
- The `/me/workspaces/:wid/guardian/*` route is **deliberately not a tenant route** (D12): the
  student's membership is inactive, so the workspace guard would refuse it. It is `@CrossTenant()`,
  filtered by the caller's `userId`, and listed as such in the isolation suite.
- Tenant routes answer `403 GUARDIAN_CONSENT_REQUIRED` (`details.status`) for the three consent
  statuses and `403 MEMBERSHIP_INACTIVE` for `PENDING_APPROVAL`; `GET /me/workspaces` carries
  `guardian { emailMasked, status, consentExpiresAt }` for the waiting panel.
- The guardian page token (D6, owner Q5) serves the sessions view, revoke and re-grant; it never
  expires and is replaced on every re-grant. `PATCH …/students/{uid} { guardianEmail }` clears both
  tokens of the previous guardian and re-arms a request to the new address (refused with
  `409 CONSENT_ALREADY_DECIDED` while the link is `ACTIVE`: the guardian must revoke first).
- Grant / re-grant into a suspended or deleting workspace → `423`; refuse / revoke always work.
- Nothing is ever purged by refusal, revocation or expiry (D-O5); other workspaces are untouched.

## CSV import

`POST /workspaces/{wid}/invitations/import?dryRun=true` with JSON `{ fileName, content }` returns
the preview; without `dryRun` it answers `202 { importId }` and queues the job.

- Format: header row required; columns `email` (required), `first_name`, `last_name`,
  `guardian_email`, `birth_date` (`YYYY-MM-DD`), `course_codes` (`;`-separated); UTF-8 with an
  optional BOM; `,` or `;` detected on the header line.
- Limits: 1 MiB (body over the limit → `413 PAYLOAD_TOO_LARGE`; `content` over 1 MiB → `422`;
  the API's JSON body limit is raised to 1 MiB for every route), 500 data rows (`413 IMPORT_TOO_LARGE`), no valid row → `422 IMPORT_NO_VALID_ROWS`, one
  `QUEUED | RUNNING` import per workspace → `409 IMPORT_IN_PROGRESS`.
- Outcomes: `OK`, warnings `OK_COURSES_IGNORED` (course codes are dropped until SP3) and
  `OK_GUARDIAN_AT_ACCEPT` (minor without guardian email: asked at acceptance); invalid
  `INVALID_EMAIL`, `DUPLICATE_IN_FILE`, `ALREADY_MEMBER`, `ALREADY_INVITED`, `INVALID_BIRTH_DATE`,
  `INVALID_GUARDIAN_EMAIL`; worker results `CREATED`, `FAILED` (email failed — the invitation
  exists, « Renvoyer » it).
- Job: `invitations.import_csv { importId, workspaceId }` on `imports`, `jobId = import:{id}:csv`
  (BullMQ refuses a custom id with a single `:`), 3 attempts. The worker generates each token,
  persists outcome and `processedRows` after every row; a retry resumes at `processedRows`, and a
  row created just before a crash is found pending (`ALREADY_INVITED`), so nobody is emailed twice.
  Last attempt failed → `FAILED` with `error`. End: `COMPLETED`, email `imports.completed`.
- Report: `GET …/invitations/import/{id}/report` → CSV `line,email,outcome,message`.
- The worker repeats the API's « already member / already invited » checks with its own two
  queries (it does not import API code).

## Audit actions and events

Audit (all per workspace, never a token or hash): `invitation.created | updated | resent |
revoked | accepted | expired`, `invite_link.created | updated | used`, `member.approved |
rejected`, `student.updated`, `guardian.consent_requested | granted | refused | revoked | expired`,
`guardian.email_changed` (masked addresses), `invitations.import_started` (importer) /
`invitations.import_completed` (`SYSTEM`). Expiry rows are `SYSTEM` with `requestId = job:<id>`.

Events (`apps/api/src/members/events.ts`, EventEmitter2, in-process): `InvitationAcceptedEvent`,
`MembershipActivatedEvent`, `MembershipDeactivatedEvent` (`CONSENT_REFUSED`, `CONSENT_REVOKED`,
`REJECTED`). The worker's consent expiry cannot emit them (see « Hooks for later plans »).

## Hooks for later plans

| Plan | Fills                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SP3  | `courseIds` of invitations / invite links → `Enrollment` at acceptance; CSV `course_codes` validated against real course codes; student `courses`                         |
| SP4  | students list `progressPercent`, `lastActivityAt`; profile `progress`, `activity`                                                                                         |
| SP5  | guardian page `sessions` (AC-SAFE-06), cancel future participations on `MembershipDeactivatedEvent`; a `sessions` job from the worker's consent expiry; `Idempotency-Key` |
| SP6  | `attendanceRate`; disconnect rooms ≤ 60 s on `MembershipDeactivatedEvent` (AC-INV-11)                                                                                     |
| SP7  | the emails move to `Notification` / `NotificationDelivery` (template keys are stable); in-app `INVITATION_ACCEPTED` replaces the inviter email                            |

## Troubleshooting

- **An import stays `QUEUED` / `RUNNING`.** Check the worker is up and the `imports` queue (BullMQ
  job `import:{id}:csv`). A job in the failed set with attempts left will retry and resume. If the
  job is gone but the row is stuck, set `invitation_import.status = 'FAILED'` with an `error` (the
  workspace can import again); rows already `CREATED` keep their invitations, and a new import of
  the same file reports them `ALREADY_INVITED`.
- **A guardian lost the consent email or the link expired.** The teacher clicks « Renvoyer au
  tuteur » on the student row (or the student uses the waiting panel): a new 14-day link, the old
  one answers `410`. Wrong address → edit the guardian email on the student profile.
- **A guardian lost the guardian-page link.** There is no resend of that link in SP2 (Q5). If the
  consent is `ACTIVE`, the student keeps access; to issue a new page link the guardian must
  re-grant from a link he holds. Otherwise change the guardian email (if not `ACTIVE`) or resend
  the consent request.
- **A re-granted guardian's old page link fails.** Expected: every re-grant replaces the token; the
  confirmation email of the re-grant carries the new one.
- **`429` on a public link.** The IP hit 10 failed lookups in a minute (shared NAT, a typo loop);
  it clears after 60 s, or `DEL token-attempt:{scope}:{ip}`.
- **A student sees « Page introuvable » in a workspace.** His membership is `REJECTED` / `REMOVED`;
  a waiting one gets the waiting panel instead.
