# Steps — progress tracker

What is done, in progress and still to do on Nibras. Updated as each task lands.

Legend: ✅ done · 🔄 in progress · ⏳ to do · 🙋 owner action

**Last update:** 2026-10-21

## Overview

| Sub-project                     | Branch                     | Status             |
| ------------------------------- | -------------------------- | ------------------ |
| SP0 Monorepo and infrastructure | `main`                     | ✅ merged          |
| SP1 Auth, tenancy and roles     | `main`                     | ✅ merged          |
| SP1.5 Frontend redesign         | `main`                     | ✅ merged          |
| Rename TT → Nibras              | `main`                     | ✅ merged          |
| SP1.6 Security hardening        | `main`                     | ✅ merged (T0–T12) |
| SP2 Students and invitations    | `sp2/students-invitations` | 🔄 T15 of T0–T16   |
| SP3 Courses, content and media  | `sp3/courses-media`        | 🔄 T8 of T0–T18    |
| SP4–SP11                        | —                          | ⏳ not planned yet |

Specs and plans: [`docs/superpowers/specs/`](docs/superpowers/specs/),
[`docs/superpowers/plans/`](docs/superpowers/plans/).

## SP1.6 Security hardening ✅

| Task | Content                                                              | Status |
| ---- | -------------------------------------------------------------------- | ------ |
| T0   | nodemailer 10, audit ignore list                                     | ✅     |
| T1   | Refuse placeholder secrets and insecure settings outside development | ✅     |
| T2   | Safe `create-super-admin` (`--promote-existing`, `--password-stdin`) | ✅     |
| T3   | Abuse reporter identity visible to super-admins only                 | ✅     |
| T4   | Password step-up for 2FA setup and disable                           | ✅     |
| T5   | Exactly one owner per organisation, race-safe transfer               | ✅     |
| T6   | Tenant isolation suite (foreign ids, cursors, bodies, read-only)     | ✅     |
| T7   | Abuse escalation emails through the job queue                        | ✅     |
| T8   | Per-service staging environment, hardened containers                 | ✅     |
| T9   | Slim production images, `verify-image.sh` in CI                      | ✅     |
| T10  | Pinned GitHub Actions, SSH host-key check, Dependabot                | ✅     |
| T11  | Security CI: audit, dependency review, CodeQL, gitleaks, trivy       | ✅     |
| T12  | Security runbook, final review, merge                                | ✅     |

## SP2 Students and invitations 🔄

| Task | Content                                                              | Status |
| ---- | -------------------------------------------------------------------- | ------ |
| T0   | Contracts: error codes, token helpers, schemas                       | ✅     |
| T1   | Database: invitations, invite links, guardian links, imports (RLS)   | ✅     |
| T2   | 13 emails in FR / AR / EN                                            | ✅     |
| T3   | API foundations: optional auth, consent gate, attempt limiter        | ✅     |
| T4   | Invitations API                                                      | ✅     |
| T5   | Public invitation acceptance (register / join, minors)               | ✅     |
| T6   | Group invite codes, public join, approval                            | ✅     |
| T7   | Guardian API: consent, guardian page, resends                        | ✅     |
| —    | Merge of final SP1.6 into SP2, isolation tables extended             | ✅     |
| T8   | Students API: list, profile, guardian email change                   | ✅     |
| T9   | Daily expiry of consents and invitations                             | ✅     |
| T10  | CSV import (API + worker)                                            | ✅     |
| T11  | Web: public invite / join pages, waiting panel, dashboard badges     | ✅     |
| T12  | Web: guardian consent page, guardian page, minors notice placeholder | ✅     |
| T13  | Web: students page, invite dialog, invite links, approvals           | ✅     |
| T14  | Web: student profile, staff invitations, e2e seeding through the API | ✅     |
| T15  | Web: CSV import dialog, accessibility sweep, budget                  | 🔄     |
| T16  | Final review, runbook, merge into `main`                             | ⏳     |

## SP3 Courses, content and media 🔄

| Task | Content                                                           | Status |
| ---- | ----------------------------------------------------------------- | ------ |
| T0   | Contracts: courses, structure, media, enrollments, rich text      | ✅     |
| T1   | Database: courses, modules, lessons, media, enrollments, progress | ✅     |
| T2   | S3 storage provider (MinIO / OVH Object Storage)                  | ✅     |
| T3   | Video provider: S3 passthrough + Cloudflare Stream adapter        | ✅     |
| T4   | API / worker / staging wiring, `s3:init`                          | ✅     |
| T5   | Courses API: CRUD, optimistic locking, lifecycle                  | ✅     |
| T6   | Modules and lessons API, reorder                                  | ✅     |
| T7   | Media API: resumable upload, checks, playback, webhooks           | ✅     |
| T8   | Worker: media processing, webhooks, cleanup                       | 🔄     |
| T9   | Enrollments + SP2 invitation hooks                                | ⏳     |
| T10  | Student learning API (`/me/courses`, locks, progress)             | ⏳     |
| —    | Merge SP2 into SP3                                                | ⏳     |
| T11  | Web: course list, create dialog, settings                         | ⏳     |
| T12  | Web: structure editor (drag and drop), upload engine              | ⏳     |
| T13  | Web: rich-text editor                                             | ⏳     |
| T14  | Web: enrollment panel, student profile courses                    | ⏳     |
| T15  | Web: student pages (my courses, outline, lesson)                  | ⏳     |
| T16  | Web: video player, PDF viewer, watermark, CSP                     | ⏳     |
| T17  | E2E, accessibility, demo course in the seed                       | ⏳     |
| T18  | Final review, runbook, merge into `main`                          | ⏳     |

## Next sub-projects (PRD §18) ⏳

| #    | Sub-project                 |
| ---- | --------------------------- |
| SP4  | Progress and activity       |
| SP5  | Scheduling and calendar     |
| SP6  | Live room and attendance    |
| SP7  | Notifications and reminders |
| SP8  | Messaging                   |
| SP9  | Session reports             |
| SP10 | Dashboards and analytics    |
| SP11 | Compliance and MVP launch   |

## Owner actions 🙋

| Action                                                                                     | Status |
| ------------------------------------------------------------------------------------------ | ------ |
| Answer SP1.6, SP2 and SP3 planning questions                                               | ✅     |
| Free disk space on C:                                                                      | ✅     |
| Push `main` to GitHub (`git push origin main`)                                             | ⏳     |
| GitHub: Dependabot alerts, secret scanning + push protection, CodeQL default setup **off** | ⏳     |
| GitHub: `STAGING_SSH_FINGERPRINT` secret (before the first staging deploy)                 | ⏳     |
| Staging: S3 settings in `.env.staging`, `s3.<domain>` proxy, run `s3-init` once            | ⏳     |
| Legal texts FR / AR / EN, including the minors notice                                      | ⏳     |
| Logo and brand colours                                                                     | ⏳     |
| Native review of the Arabic and English texts                                              | ⏳     |
| Choose the production video provider (Cloudflare Stream or EU alternative)                 | ⏳     |
| Rename the local `TT` folder to `nibras` (after the work session)                          | ⏳     |
