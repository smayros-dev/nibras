# Courses, content and media (SP3)

How courses, their structure, media uploads, playback and enrollments work, how to run them in
staging/production, and what to do when they go wrong. Spec:
`docs/superpowers/specs/2026-10-19-sp3-courses-media-design.md`. Code: `apps/api/src/` `courses`,
`structure`, `media`, `enrollments`, `learn`; `apps/worker/src/media/*`,
`processors/{media,course-notify,course-purge}.processor.ts`; `packages/providers/src/{storage,video}`;
constants in `packages/contracts/src/{course,media}-constants.ts` and `queues.ts`; web in
`apps/web/src/components/{courses,learn,rich-text}` and `src/lib/upload`.

## Providers and environment

| Variable                                        | Where             | Notes                                                                                                                   |
| ----------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `S3_ENDPOINT`, `S3_ACCESS_KEY/SECRET_KEY`       | api, worker       | MinIO locally/staging, OVH Object Storage in production (Q7); `minioadmin` and placeholders refused outside development |
| `S3_PUBLIC_ENDPOINT`                            | api, worker       | the host browsers reach; presigned URLs only (empty = `S3_ENDPOINT`)                                                    |
| `S3_BUCKET`, `S3_REGION`, `S3_FORCE_PATH_STYLE` | api, worker       | one private bucket; keys `w/{wid}/{kind}/{mediaId}/{filename}`; never public, never listable                            |
| `VIDEO_PROVIDER`                                | api, worker       | `s3` (default: MP4/WebM passthrough in the bucket, no transcoding) or `cloudflare_stream`                               |
| `CLOUDFLARE_*` (six, see staging.md)            | api (worker: two) | required only with `cloudflare_stream`                                                                                  |
| `MEDIA_ORIGINS`                                 | web               | origins of the object store (and the Stream customer subdomain) for `connect-src`, `media-src`, `img-src`               |

- **Bucket and CORS:** `pnpm --filter @nibras/api s3:init` (or `node apps/api/scripts/s3-init.mjs`
  in the api image) creates the bucket and sets CORS for `WEB_ORIGIN` (GET/PUT/HEAD, `ETag`
  exposed). MinIO answers `NotImplemented` to CORS and allows every origin. Idempotent.
- **`MEDIA_ORIGINS` must be `https://` outside development:** the production CSP carries
  `upgrade-insecure-requests`, so an `http://` media origin is rewritten to `https://` by the
  browser and every upload `PUT`, PDF fetch and video request fails.
- **Cloudflare Stream (optional, D3/Q1):** set `VIDEO_PROVIDER=cloudflare_stream` and the six
  `CLOUDFLARE_*` values; register the webhook `https://<web>/api/v1/webhooks/media/cloudflare_stream`
  (`PUT /accounts/{id}/stream/webhook`, the returned secret is `CLOUDFLARE_STREAM_WEBHOOK_SECRET`);
  add `https://customer-<code>.cloudflarestream.com` to `MEDIA_ORIGINS`. The adapter is unit-tested
  only: the first staging run is the real test (upload, webhook `200`, playback, delete). PDFs and
  images stay in S3 whatever the provider. Assets created under one provider are served by it; do
  not switch providers on a workspace that has hosted videos without migrating them.
- **Key rotation:** S3 keys — add the new key on the store, update `.env.staging`, restart api and
  worker (presigned URLs signed with the old key die with it, ≤ 2 h). Stream signing key — create a
  new key, deploy its id/PEM, delete the old one after 2 h (live tokens). Webhook secret — `PUT` the
  webhook again and deploy the new secret at once (requests in between answer `401` and Cloudflare
  retries).

### Staging host checklist (MinIO behind the TLS proxy)

1. `.env.staging`: `S3_ENDPOINT=http://minio:9000`, `S3_PUBLIC_ENDPOINT=https://s3.<domain>`,
   `S3_BUCKET=nibras-staging`, random `S3_ACCESS_KEY/S3_SECRET_KEY`,
   `MEDIA_ORIGINS=https://s3.<domain>`, `VIDEO_PROVIDER=s3`.
2. Proxy host `s3.<domain>` (TLS) → `127.0.0.1:9000`: keep the `Host` header (it is signed:
   nginx `proxy_set_header Host $host;`), bodies ≥ 16 MiB (`client_max_body_size 16m;` or `0`), no
   request buffering (`proxy_request_buffering off;`), `Range` and `ETag` passed untouched.
3. After the first `up -d`, run s3-init once (see [staging.md](staging.md)).
4. Smoke: upload a PDF in a lesson (parts reach `s3.<domain>`, `ETag` visible), open it as a
   student (pdf.js renders, no CSP violation in the console).

With OVH Object Storage skip the proxy host: `S3_ENDPOINT` is the OVH endpoint,
`S3_PUBLIC_ENDPOINT` empty, `MEDIA_ORIGINS` that endpoint, CORS set by s3-init.

## Course lifecycle and editing

- `DRAFT → PUBLISHED` (≥ 1 module with ≥ 1 lesson that is TEXT or whose media is `READY`, else
  `422 COURSE_NOT_PUBLISHABLE { missing, lessons }`), `PUBLISHED → DRAFT` (unpublish: students
  lose access, enrollments and progress kept), `PUBLISHED → ARCHIVED` (read-only for students,
  progress frozen), `ARCHIVED → PUBLISHED`. `DELETE` only from `DRAFT`/`ARCHIVED` and with no
  ACTIVE enrollment (`409 COURSE_STATUS_INVALID { hint: 'ARCHIVE_FIRST' }` /
  `409 COURSE_HAS_ACTIVE_ENROLLMENTS { count }`): `deletedAt` set (soft). The daily
  `course.purge_deleted` (03:30 UTC) hard-deletes courses deleted > 30 days ago and sends their
  media used nowhere else to `media.delete`.
- **Optimistic locking (D-P14):** every course/module/lesson mutation bumps `Course.version`; GET
  detail/structure answer `ETag: "<version>"`. `PATCH` and reorders need `If-Match` (`"7"`, `7` or
  `W/"7"`): missing → `428 VERSION_REQUIRED`, stale → `409 VERSION_CONFLICT { currentVersion }`
  (the UI offers « Recharger » / « Écraser »). Creates and deletes check it when sent. Status
  transitions need none (the state machine guards them).
- Reorder = full id set in one transaction under `SET CONSTRAINTS … DEFERRED` (deferrable unique
  positions). Rich text = ProseMirror JSON whitelist (`RichTextDocSchema`), images by `mediaId`,
  never HTML.
- Removing a member from the workspace revokes his ACTIVE enrollments there
  (`MEMBERSHIP_REMOVED`, `SYSTEM` audit, progress kept); a rejected pending student loses the
  courses his code assigned (`MEMBERSHIP_REJECTED`).

## Uploads and media states

| Mode           | Used for                        | Resume                                                                                                                                                                                                                           |
| -------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `S3_MULTIPART` | PDF, IMAGE, FILE; VIDEO on `s3` | 8 MiB parts, 3 parallel presigned `PUT`s (1 h URLs); state in `localStorage nibras-upload:{mediaId}`; « Reprendre l'envoi » with the same file → `GET …/media/{id}/upload` (ListParts + fresh URLs) sends only the missing parts |
| `TUS`          | VIDEO on `cloudflare_stream`    | tus-js-client against the Cloudflare URL (its own store); see FIX-LATER for pause/resume                                                                                                                                         |

`UPLOADING` → `complete` (size ≤ kind limit, file signature via `file-type` — `415
INVALID_FILE_SIGNATURE` / `422 MEDIA_KIND_MISMATCH`, quota with the actual size — `402`; any
refusal deletes the object and marks the asset `FAILED`) → `PROCESSING` → `media.process` (PDF page
count, encrypted → `FAILED ENCRYPTED`; image size; MP4 duration by box probe, > 4 h refused) →
`READY`. Cloudflare videos go `PROCESSING` → `READY`/`FAILED` by webhook (`media.webhook.process`).
The hourly `media.cleanup_abandoned` (minute 15): `UPLOADING` > 24 h → `FAILED ABANDONED`
(multipart aborted); `PROCESSING` > 6 h → Cloudflare `getAsset` reconciliation, else `FAILED
TIMEOUT` and the `media.failed` email to the owner. The editor polls every 5 s while a chip is
UPLOADING/PROCESSING. `DELETE` → `409 MEDIA_IN_USE { lessons }` while any lesson uses it, else
`DELETING` + `media.delete` (provider delete, then the row and the quota). Limits: VIDEO 4 GiB /
4 h, PDF 50 MiB, IMAGE 5 MiB, FILE 10 MiB; S3 video `video/mp4`, `video/webm` only.

**Quota (D17):** the check at `POST …/media/uploads` counts `storageUsedBytes` + the declared sizes
of `UPLOADING` assets (`402 QUOTA_EXCEEDED { usedBytes, reservedBytes, quotaBytes, requestedBytes }`);
bytes are counted at `complete` (Cloudflare: at READY) into `countedBytes` and released exactly by
`media.delete`. Shown on the workspace settings page; the super-admin changes the quota.

## Playback, watermark, access

- Student: `GET /me/lessons/{lid}/playback` → VIDEO 2 h (`MP4` presigned or `HLS` signed manifest),
  PDF 5 min inline; `…/download` → 5 min attachment only if `allowDownload` (else `403
DOWNLOAD_NOT_ALLOWED`). Teacher preview: `GET /workspaces/{wid}/media/{id}/playback`.
- 30 grants per user per hour (Redis `playback:{userId}`) → `429 RATE_LIMITED` and the `warn`
  line `media.playback_rate_exceeded` (alert source). Issuance logs `media.playback_issued` (ids
  only) and counts `media_playback_issued_total`; never audited (D13).
- The player renews silently 60 s before expiry or on a `403` from the store; a refused renewal
  (`ENROLLMENT_REVOKED`, `COURSE_NOT_AVAILABLE`) shows « Vous n'avez plus accès à ce cours ».
- Watermark: `{email} · {HH:mm}` overlay on the fullscreen wrapper, moves every 30 s (6 positions),
  `aria-hidden`, not dismissable (D-O8: no DRM).
- Access (`resolveLessonAccess`): enrollment ACTIVE (`403 ENROLLMENT_REVOKED`), membership ACTIVE,
  course `PUBLISHED|ARCHIVED` and not deleted (`403 COURSE_NOT_AVAILABLE`), locks: module
  `PREVIOUS_MODULE_COMPLETED` against the nearest previous non-optional module (`403
MODULE_LOCKED`), `sequentialLessons` against the previous required lesson (`403 LESSON_LOCKED`),
  media not ready → `409 MEDIA_NOT_READY`.
- Progress subset (SP4 extends it): `opened` → `IN_PROGRESS`, « Marquer comme terminé » /
  « Annuler terminé »; `progressPercent = floor(100 × completed required / required)` over
  non-optional modules (D-P8); `completedAt` kept once set. SP4 adds segments, auto-completion,
  `lastPositionS` and the ≤ 10 s revocation loop.

## Audit, events, jobs, isolation

- Audit actions: `course.created|updated|published|unpublished|archived|restored|deleted|reassigned`,
  `module.*`, `lesson.*` (`created|updated|deleted|reordered`), `media.upload_created|completed|deleted`,
  `enrollment.created|revoked`; `SYSTEM`: `media.failed`, `course.purged`, hook enrollments and
  revocations.
- Events (EventEmitter2): `CourseAssignedEvent`, `CoursePublishedEvent`, `EnrollmentRevokedEvent`,
  `InviteLinkJoinedEvent`. Emails `course.assigned` / `course.published` / `media.failed` by jobs.
- Jobs: `media` queue — `media.process` (`media:{id}:process`), `media.webhook.process`
  (`webhook:{id}:process`), `media.cleanup_abandoned` (scheduler `media-cleanup-abandoned`),
  `media.delete` (`media:{id}:delete`); `notifications` — `course.assigned_notify`,
  `course.published_notify` (`course:{id}:published-v{version}`); `compliance` —
  `course.purge_deleted` (scheduler `course-purge-deleted`).
- Isolation suite: `FOREIGN_PARAMS` for `:cid`, `:mid`, `:lid`, `:mediaId`, `:uid` (enrollments);
  `FOREIGN_BODIES` for `mediaAssetId`, `coverMediaId`, inline image `mediaId`, `studentUserIds`,
  `courseIds`, `moduleIds`, `lessonIds`, `ownerUserId`. The `/me` learn routes are outside the
  generic suite (cross-tenant by design, D7) and carry their own cross-workspace cases.

## Troubleshooting

- **Asset stuck `PROCESSING`.** S3: check the worker and the `media` queue for
  `media:{id}:process`; re-add it, or wait for the hourly cleanup (6 h → `FAILED TIMEOUT`).
  Cloudflare: a lost webhook is reconciled by `getAsset` at the next hourly run.
- **Asset stuck `DELETING`.** The provider/storage delete failed; the `media.delete` job retries.
  Pressing « Supprimer » again re-enqueues it (same job id).
- **Upload fails right after the first part (the dialog hints at CORS / ETag).** Bucket CORS does not expose
  `ETag` (OVH: run s3-init again) or the proxy strips it; a `PUT` blocked in the console →
  `MEDIA_ORIGINS` missing the store, or `http://` in production.
- **Webhook `401 WEBHOOK_SIGNATURE_INVALID`.** `details.reason`: stale `time` (host clock skew >
  5 min — fix NTP) or bad signature (secret rotated on one side). Nothing is stored on a `401`;
  Cloudflare retries. `200 { duplicate: true }` is a replay, harmless.
- **`429` on playback.** 30 grants/h for that user; the window clears within the hour, or
  `DEL playback:{userId}` in Redis.
- **A teacher cannot delete an archived course.** `COURSE_HAS_ACTIVE_ENROLLMENTS`: revoke the
  listed students on the Étudiants tab (removed members are revoked automatically).
- **Emptying a test bucket.** The API/worker suites empty their own derived bucket
  (`…-api-test`, `…-worker-test`) and refuse any other; by hand: `mc rm --recursive --force
local/<bucket>` (never on `S3_BUCKET` of a shared environment).

## FIX-LATER

- `/media` WebSocket namespace for `media.status_changed` (Q2; SP7/SP8) — polling at 5 s meanwhile.
- In-app `COURSE_PUBLISHED` (Q3; SP7) replaces the interim email.
- Course codes for the CSV `course_codes` column (Q4; V2-g).
- Video thumbnails on the S3 provider (client-side capture at upload).
- `Idempotency-Key` on enrollment batches.
- Per-asset playback counters for the super-admin cost view (R5; SP10).
- Revoked-access-mid-playback save loop (SP4, AC-ENR-04).
- tus pause/resume restarts the Cloudflare upload from zero: only S3 multipart state is in the
  resume store; persist tus-js-client's upload URL (fingerprint store) per media.
- Teacher preview lesson route first-load JS is 249.2 kB of 250 kB: the next byte on the
  workspace/course layouts tips it over. Splitting the course tab bodies out of `course-frame.tsx`
  made Turbopack re-partition shared chunks (+5 kB on every workspace route), so it was not done;
  revisit with a route-group split of the preview or chunk tuning before adding anything there.
- The course purge deletes media referenced only by the purged course; a `media.delete` enqueue
  lost after the purge commit leaves the asset `DELETING` until someone presses « Supprimer ».
