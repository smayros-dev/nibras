# Design summary — Online course platform with live video sessions

**Date:** 2026-10-10  
**Status:** Design approved for implementation planning — v2.1 integrates the builder review and the owner's answers (D-O5…D-O8); remaining planner calls still open to owner review  
**Authoritative spec:** [`PRD.md`](../../../PRD.md) (v2.1, French). This file is the English entry point that `superpowers:writing-plans` should start from; every number, rule and acceptance criterion lives in the PRD and must not be duplicated or re-decided here.  
**Previous version:** `docs/archive/PRD-v1.0.md`

## Intent

A SaaS teaching platform for the Maghreb and France where a teacher (independent, or inside a school/academy "organisation") manages students, publishes recorded courses (video, PDF, rich text), runs scheduled live video sessions, and gets attendance, progress and session reports automatically. Students (often minors, on Android, on unstable networks) and their guardians see courses, sessions and progress in one place. UI in FR (default), AR (RTL) and EN.

The MVP answers one question: *can a teacher, in FR/AR/EN and from a phone, manage students (including minors), give them access to courses, schedule and run reliable live sessions, and get attendance and progress computed automatically?*

## Goals (MVP, measured at 90 days)

1. Teacher activation ≥ 60 % (first course published and ≥ 1 student invited within 7 days).
2. Live sessions are reliable: ≥ 98 % room-join success, median click-to-media < 3 s.
3. Tracking is automatic: 100 % of completed sessions have computed attendance; ≥ 70 % have a report within 48 h.
4. Works in FR/AR(RTL)/EN on mobile (PWA).
5. GDPR + INPDP compliance is operational: data export/deletion, mandatory parental consent for minors, audit log.

## Non-goals (phased out, not refused)

Public marketplace/SEO, payments (V3, behind a provider abstraction designed now), native apps (PWA first), whiteboard/recording/AI (V2–V3), external LMS integrations/SSO, rooms larger than 1 + 12.

## Anti-goals (never)

Not a YouTube for teachers (no public content/recommendations); not a generic Zoom (rooms exist only for a scheduled session with identified participants and computed attendance); not a social network (no student↔student messaging outside moderated course channels); no intrusive surveillance (no proctoring, no off-session tracking, no automated disciplinary scoring); no unsolicited AI (opt-in per workspace, disclosed, never trained on user data).

## Owner decisions (binding) — PRD §4.1

- **D-O1 Tenancy: both.** Independent teacher = `PERSONAL` workspace; optional `ORGANIZATION` workspace with admins and several teachers. Every tenant-owned row carries `workspace_id`; row-level isolation from day one.
- **D-O2 Stack.** pnpm + Turborepo TypeScript monorepo; Next.js App Router (web + PWA); NestJS API; PostgreSQL + Prisma; Redis + BullMQ; S3-compatible storage; managed VOD with signed playback; LiveKit (WebRTC) with short-lived server-issued tokens; transactional email; WebSockets for chat/notifications.
- **D-O3 Market & compliance.** Maghreb + France; FR/AR(RTL)/EN; timezone-aware scheduling; GDPR + Tunisian law 2004-63 (INPDP), Moroccan 09-08, Algerian 18-07; minors → parental consent / guardian accounts; payments later via Stripe + Konnect/Flouci/CMI behind an abstraction.
- **D-O4 Scope.** Full product specified, phased with P0 (MVP) / P1 (V2) / P2 (V3) and rationale.
- **D-O5 Guardian consent is per workspace.** The consent email names the workspace/teacher; a minor joining a second workspace needs a new consent; revocation suspends only that workspace's membership (`SUSPENDED_CONSENT_REVOKED`); pedagogical history is kept for the legal retention period; personal data is purged only on account deletion or erasure request, never automatically. `GuardianLink` and `Consent(GUARDIAN_PARENTAL)` are workspace-scoped (unique on `student + workspace`).
- **D-O6 Teacher vetting at MVP = light checks + safeguards.** Verified email and phone (SMS OTP), acceptance of terms and a code of conduct (gate `TEACHER_NOT_VERIFIED` before inviting/publishing/opening a room), report-abuse button in rooms/messages/profiles/courses (`AbuseReport`), super-admin can suspend a teacher (`User.status = SUSPENDED`), guardians can see their minor's sessions via a signed link. Full ID/diploma verification is V2.
- **D-O7 No automatic personal workspace for teachers invited into an organisation.** They may create one later unless the org sets `allow_personal_workspaces = false`. Self-signup teachers still get one.
- **D-O8 Recorded video protection = short-lived signed playback tokens (2 h) + visible watermark** (student email) from the MVP. Tokens are **bearer tokens** (not user-bound at playback); no DRM, no user-bound playback proxy; the residual risk is accepted.

## Planner calls (marked "choix du planificateur" in PRD §4.2 — owner may overturn any)

| ID | Call |
|---|---|
| D-P1 | VOD default **Cloudflare Stream** (predictable pricing, no egress, PoPs in Tunis/Algiers/Casablanca/Paris, tus resumable upload, signed tokens, R2 synergy); **Mux** as documented alternative behind a `VideoProvider` interface. |
| D-P2 | Room capacity MVP **1 teacher + 12 students** with bidirectional video (client-side limit on mid-range Android/4G; 4×3 grid); V2 "classroom mode" 1 + 40. |
| D-P3 | **Minor = under 18** in all jurisdictions; guardian consent blocks all content/session access until granted. |
| D-P4 | **EU (Paris) hosting**, LiveKit Cloud managed at MVP; cross-border transfer authorisations are legal deliverables. |
| D-P5 | Session lifecycle: `LIVE` when the teacher opens the room; students wait in a lobby; explicit end by teacher or **auto-complete after 5 min of empty room**; resume allowed within 10 min; `NO_SHOW` set at `end_at` if the teacher never opened. **Overrun:** `auto_end_at = end_at + 60 min`, warning 10 min before ("ends in 10 min"); the teacher may extend by 30 min at most twice (each pushes `auto_end_at` back 30 min); absolute cap = original `end_at + 120 min`; auto-end reason `TIMEOUT`. `UPCOMING` is derived, never stored. |
| D-P6 | Join windows: teacher 15 min before, students 10 min before (lobby), late join until `end_at`. |
| D-P7 | Attendance defaults (per-workspace configurable): PRESENT (joined ≤ 10 min late, ≥ 75 % of effective duration), LATE, PARTIAL (25–75 %), ABSENT (< 25 % or never). |
| D-P21 | Attendance base: effective duration = overlap of the scheduled window `[start_at, end_at (+ extensions)]` with the actual live window; opening the room early never penalises an on-time student; presence = sum of actually connected time (± 5 s); reconnection gaps < 5 min are merged for display only, disconnected time never counts. |
| D-P22 | Revoking a course enrollment: the student keeps the session in progress until they leave but cannot rejoin; participations in future sessions linked to that course are cancelled automatically with notifications to student and teacher. Room-token check: participant of the session AND active workspace membership AND (session has no course OR enrollment active). |
| D-P23 | Reminder schedule lives only on `Session.reminder_offsets_min` (jobs per session and offset); users choose channels per notification type and may opt out of reminders, but have no personal offsets (`User.reminder_offsets_min` removed). |
| D-P8 | Progress formula: video lesson complete at ≥ 90 % *unique* watched time or manual mark; PDF/text manual mark after opening; course % = required lessons completed / required published lessons (no weighting at MVP; can decrease when content is added). |
| D-P9 | Reminders default 24 h / 15 min / at start; MVP channels in-app + email; web push and WhatsApp/SMS in V2. |
| D-P10 | Student self-booking (availability + booking policy) is **P1/V2**; teacher scheduling incl. RRULE recurrence is P0. Data model reserved now. |
| D-P11 | MVP messaging = 1:1 teacher↔student text only; room chat persisted in the same model (`Conversation` type `SESSION`); course channels/attachments/moderation P1. |
| D-P12 | 2FA (TOTP + recovery codes) mandatory for `SUPER_ADMIN` and organisation `OWNER`/`ADMIN`; available to all; enforceable on teachers by org policy (P1). |
| D-P13 | Tenant isolation = Prisma extension injecting `workspace_id` **and** PostgreSQL RLS (`SET LOCAL app.workspace_id`). |
| D-P14 | REST `/api/v1`, tenant resources under `/workspaces/{id}/…`, cross-workspace aggregates under `/me/…`; optimistic locking with `version` + `If-Match` → `409`. |
| D-P15 | Upload limits: video 4 GB / 4 h, PDF 50 MB, image 5 MB, message attachment 10 MB; storage quota 20 GB personal / 200 GB organisation. |
| D-P16 | Western digits (0-9) in Arabic locale, Gregorian calendar. |
| D-P17 | AI (V2/V3) opt-in per workspace: abstracted STT provider; generation with Claude (`claude-opus-5-5` default, `claude-haiku-5-5` for cheap routing); no training on user data. |
| D-P18 | Email invitations strictly bound to the invited address; group invite links/codes are not, with optional teacher approval. |
| D-P19 | Retention: messages for workspace lifetime, recordings 12 months (3–24 configurable), app logs 30 days, audit log 2 years, deleted accounts 30-day grace, backups 30 days. |
| D-P20 | Concurrent edits via optimistic locking only (no realtime collaboration before V3). |

Other notable NFR numbers (PRD §14): API p95 < 300 ms read / < 600 ms write; LCP < 2.5 s on mid-range Android 4G; availability SLO 99.5 % (MVP) → 99.9 % (V2); RPO ≤ 15 min, RTO ≤ 4 h; OWASP ASVS L2; WCAG 2.1 AA with full RTL.

## Roles

`SUPER_ADMIN` (platform) · workspace roles `OWNER`, `ADMIN` (org, with `can_teach` flag), `TEACHER`, `ASSISTANT` (P1), `STUDENT`, `GUARDIAN` (consent P0, read-only account P1). Full permission matrix in PRD §7. v1 inconsistencies fixed: teachers see reports; screen share is P1 (not in MVP permissions); students do not schedule at MVP. v2.1 rulings: in an organisation only admins/owner remove a student (the owner does in a personal workspace); a course is deletable only from DRAFT/ARCHIVED with no active enrollment (PUBLISHED must be archived first); activation metric = course *published* + ≥ 1 student invited.

## Sub-project breakdown (one implementation plan each, build order) — PRD §18

| # | Sub-project | Depends on |
|---|---|---|
| 0 | Monorepo & infra (apps web/api/worker, packages, docker-compose, CI, staging, observability, i18n/RTL skeleton) | — |
| 1 | Auth, tenancy & RBAC (users, sessions, 2FA, phone OTP + code of conduct for teachers, workspaces incl. `allow_personal_workspaces`, memberships, permission guard, Prisma tenant extension + RLS, audit log, `AbuseReport` + user suspension, minimal super-admin) | 0 |
| 2 | Students & invitations (email invites, group links/codes, CSV import, per-workspace guardian consent flow + signed "child's sessions" link, student list/profile, removal) | 1 |
| 3 | Courses, content & media (course/module/lesson VIDEO/PDF/TEXT, resumable uploads, VOD + storage providers, webhooks, bearer signed playback + visible watermark, locking, enrollment, quotas) | 1 |
| 4 | Progress & activity (unique watched segments, progress formula + recompute job, activity events, revoked-access-mid-playback) | 3 |
| 5 | Scheduling & calendar (sessions, RRULE series, conflicts, DST-safe timezones, calendar views, ICS feeds, no-show job) | 2, 3 |
| 6 | Live rooms & attendance (LiveKit provider, tokens, pre-join, lobby, host controls, reconnection, audio-only fallback, webhooks + reconciliation, session state machine, attendance computation/override) | 5 |
| 7 | Notifications & reminders (catalogue, preferences, email templates FR/AR/EN, in-app + WebSocket, idempotent BullMQ reminders, digests, bounces) | 5, 6 |
| 8 | Messaging (DIRECT + SESSION conversations, WebSocket chat, unread, deletion window) | 1, 7 |
| 9 | Session reports (visible report + private notes, recommendations, publish, 24 h nudge, post-session screen) | 6, 7 |
| 10 | Dashboards & analytics (teacher/student dashboards with precise KPI definitions, product events, super-admin health) | 4, 6, 9 |
| 11 | Compliance & MVP launch (data export, account/workspace deletion + purge, consent versions, retention jobs, PWA, ASVS L2 review, pentest, legal docs, runbooks) | all |
| V2-a…h | Booking · advanced organisations & guardian portal · teacher ID/diploma verification · advanced room (screen share, recording, classroom mode) · course channels & attachments · push & WhatsApp · quizzes & assignments · advanced content (drip, server-side PDF stamping, duplication) · at-risk alerts & AI v1 | see PRD §18 |
| V3-a/b | Payments (Stripe, Konnect, Flouci, CMI) · certificates, rubrics, AI quiz generation, Q&A assistant, whiteboard, calendar sync, SSO, native app | see PRD §18 |

Each sub-project's Definition of Done lists the acceptance criteria (PRD §15, Given/When/Then) it must automate, plus FR/AR/EN translations, RTL check, audit + analytics events, and runbook updates.

## Open questions for the owner (PRD §20, each with a default assumption)

Product name/branding; MVP pricing for teachers; Tunisian hosting/legal entity and who files INPDP/CNDP/ANPDP declarations (DPO); Algerian payment gateway; self-signup for adult students (default no); confirm booking stays V2 and 1 + 12 room cap; integrated support channel; default sharing of session recordings. (The DRM question is closed by D-O8.)

## What is left to the builder (PRD §22)

Library choices (UI kit, rich-text editor, date/tz lib, PDF viewer, HLS player), visual design, exact hosting topology, physical Prisma schema details, caching/pagination/DTO shapes, PWA offline strategy, job concurrency/retry details, test data and load-test tooling, final copy (with native Arabic review). The builder must not change priorities, attendance rules (thresholds and the D-P21 base), progress rules, session windows/extensions/cap (D-P5, D-P6), the enrollment-revocation and room-token rules (D-P22), the session-owned reminder schedule (D-P23), per-workspace consent and no-auto-purge (D-O5), teacher safeguards (D-O6), the invited-teacher workspace rule (D-O7), "bearer tokens + watermark, no DRM" (D-O8), the permission matrix, limits, default providers or compliance requirements without an owner decision.
