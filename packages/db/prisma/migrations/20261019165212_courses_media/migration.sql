-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CourseLevel" AS ENUM ('PRIMAIRE', 'COLLEGE', 'LYCEE', 'SUPERIEUR', 'ADULTE', 'AUTRE');

-- CreateEnum
CREATE TYPE "LessonType" AS ENUM ('VIDEO', 'PDF', 'TEXT', 'LINK', 'EMBED', 'QUIZ', 'ASSIGNMENT');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "EnrollmentSource" AS ENUM ('MANUAL', 'INVITATION', 'INVITE_LINK');

-- CreateEnum
CREATE TYPE "LessonProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('VIDEO', 'PDF', 'IMAGE', 'FILE', 'RECORDING');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED', 'DELETING');

-- CreateEnum
CREATE TYPE "MediaProvider" AS ENUM ('CLOUDFLARE_STREAM', 'MUX', 'S3');

-- CreateEnum
CREATE TYPE "MediaFailureReason" AS ENUM ('ABANDONED', 'TIMEOUT', 'PROVIDER_ERROR', 'INVALID_SIGNATURE', 'ENCRYPTED', 'QUOTA_EXCEEDED', 'SIZE_MISMATCH');

-- CreateTable
CREATE TABLE "course" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" JSONB,
    "cover_media_id" UUID,
    "category" TEXT,
    "level" "CourseLevel",
    "language" "Locale" NOT NULL,
    "estimated_minutes" INTEGER,
    "sequential_lessons" BOOLEAN NOT NULL DEFAULT false,
    "is_certifying" BOOLEAN NOT NULL DEFAULT false,
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ,
    "archived_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "source_course_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "unlock_rule" JSONB NOT NULL DEFAULT '{"type":"NONE"}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "LessonType" NOT NULL,
    "position" INTEGER NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "estimated_minutes" INTEGER,
    "is_preview" BOOLEAN NOT NULL DEFAULT false,
    "media_asset_id" UUID,
    "allow_download" BOOLEAN NOT NULL DEFAULT false,
    "content" JSONB,
    "external_url" TEXT,
    "embed_url" TEXT,
    "quiz_id" UUID,
    "assignment_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_asset" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "provider" "MediaProvider" NOT NULL,
    "provider_asset_id" TEXT,
    "storage_key" TEXT,
    "upload_id" TEXT,
    "status" "MediaStatus" NOT NULL,
    "failure_reason" "MediaFailureReason",
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" TEXT,
    "duration_s" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "thumbnail_url" TEXT,
    "page_count" INTEGER,
    "upload_url_expires_at" TIMESTAMPTZ,
    "processing_started_at" TIMESTAMPTZ,
    "ready_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,
    "counted_bytes" BIGINT NOT NULL DEFAULT 0,
    "session_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "media_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "status" "EnrollmentStatus" NOT NULL,
    "assigned_by_user_id" UUID NOT NULL,
    "source" "EnrollmentSource" NOT NULL,
    "activated_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "revoked_reason" TEXT,
    "progress_percent" SMALLINT NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ,
    "last_activity_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_progress" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "status" "LessonProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "last_position_s" INTEGER NOT NULL DEFAULT 0,
    "watched_segments" JSONB NOT NULL DEFAULT '[]',
    "unique_watched_s" INTEGER NOT NULL DEFAULT 0,
    "opened_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "completed_manually" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_event" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,
    "error" TEXT,

    CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_workspace_id_owner_user_id_status_idx" ON "course"("workspace_id", "owner_user_id", "status");

-- CreateIndex
CREATE INDEX "course_workspace_id_status_idx" ON "course"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "course_deleted_at_idx" ON "course"("deleted_at");

-- CreateIndex
CREATE INDEX "course_owner_user_id_idx" ON "course"("owner_user_id");

-- CreateIndex
CREATE INDEX "course_cover_media_id_idx" ON "course"("cover_media_id");

-- CreateIndex
CREATE INDEX "module_course_id_idx" ON "module"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "module_course_position_key" ON "module"("course_id", "position");

-- CreateIndex
CREATE INDEX "lesson_module_id_idx" ON "lesson"("module_id");

-- CreateIndex
CREATE INDEX "lesson_media_asset_id_idx" ON "lesson"("media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_module_position_key" ON "lesson"("module_id", "position");

-- CreateIndex
CREATE INDEX "media_asset_workspace_id_status_idx" ON "media_asset"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "media_asset_owner_user_id_idx" ON "media_asset"("owner_user_id");

-- CreateIndex
CREATE INDEX "media_asset_workspace_id_created_at_idx" ON "media_asset"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "enrollment_workspace_id_student_user_id_idx" ON "enrollment"("workspace_id", "student_user_id");

-- CreateIndex
CREATE INDEX "enrollment_course_id_status_idx" ON "enrollment"("course_id", "status");

-- CreateIndex
CREATE INDEX "enrollment_student_user_id_idx" ON "enrollment"("student_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_course_id_student_user_id_key" ON "enrollment"("course_id", "student_user_id");

-- CreateIndex
CREATE INDEX "lesson_progress_workspace_id_student_user_id_idx" ON "lesson_progress"("workspace_id", "student_user_id");

-- CreateIndex
CREATE INDEX "lesson_progress_student_user_id_status_idx" ON "lesson_progress"("student_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_progress_lesson_id_student_user_id_key" ON "lesson_progress"("lesson_id", "student_user_id");

-- CreateIndex
CREATE INDEX "webhook_event_received_at_idx" ON "webhook_event"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_event_provider_provider_event_id_key" ON "webhook_event"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "user_avatar_media_id_idx" ON "user"("avatar_media_id");

-- CreateIndex
CREATE INDEX "workspace_logo_media_id_idx" ON "workspace"("logo_media_id");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_avatar_media_id_fkey" FOREIGN KEY ("avatar_media_id") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_logo_media_id_fkey" FOREIGN KEY ("logo_media_id") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course" ADD CONSTRAINT "course_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course" ADD CONSTRAINT "course_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course" ADD CONSTRAINT "course_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module" ADD CONSTRAINT "module_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module" ADD CONSTRAINT "module_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_asset"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Hand-written (Prisma cannot express these; `migrate:check` ignores them) ──────

-- SP3 spec D9 (AC-CRS-04): module and lesson positions stay unique per parent, but a reorder
-- renumbers 1..n one row at a time inside one transaction under
-- `SET CONSTRAINTS "module_course_position_key" DEFERRED` (resp. lesson). Prisma's unique indexes
-- are re-created as DEFERRABLE INITIALLY IMMEDIATE unique constraints of the same name, so every
-- other write is still checked at once and Prisma still maps a violation to P2002.
DROP INDEX "module_course_position_key";
ALTER TABLE "module" ADD CONSTRAINT "module_course_position_key"
  UNIQUE ("course_id", "position") DEFERRABLE INITIALLY IMMEDIATE;
DROP INDEX "lesson_module_position_key";
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_module_position_key"
  UNIQUE ("module_id", "position") DEFERRABLE INITIALLY IMMEDIATE;

-- SP3 spec §3: a lesson's content matches its type. LINK / EMBED / QUIZ / ASSIGNMENT are P1 types
-- (never created by SP3) and get their rule with the sub-project that ships them.
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_content_by_type_check" CHECK (
  ("type" = 'VIDEO' AND "media_asset_id" IS NOT NULL AND "content" IS NULL)
  OR ("type" = 'PDF' AND "media_asset_id" IS NOT NULL AND "content" IS NULL)
  OR ("type" = 'TEXT' AND "media_asset_id" IS NULL AND "content" IS NOT NULL)
  OR "type" IN ('LINK', 'EMBED', 'QUIZ', 'ASSIGNMENT')
);

-- A provider asset (Cloudflare Stream uid) maps to one media asset; S3 assets have no
-- provider_asset_id, so the index is partial.
CREATE UNIQUE INDEX "media_asset_provider_asset_key" ON "media_asset"("provider", "provider_asset_id")
  WHERE "provider_asset_id" IS NOT NULL;

-- D-P8: course progress is a percentage.
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_progress_percent_check"
  CHECK ("progress_percent" BETWEEN 0 AND 100);

-- ─── Hand-written: tenant isolation (PRD §13.3, D-P13) ─────────────────────────────
-- The six SP3 🏢 tables get the ENABLE/FORCE pair and the `tenant_isolation` policy copied verbatim
-- from `20261011095737_rls_and_audit_privileges` (NULLIF form, see the comment there). The `/me`
-- learn routes list the caller's enrollments and progress through `crossTenantDb()` filtered by
-- `studentUserId` (a user-scoped key in packages/db/src/tenant.ts, spec D7), then read the course
-- structure under `tenantDb(workspaceId)`, which this policy checks. `webhook_event` is a platform
-- table (no workspace) and stays outside RLS.

ALTER TABLE "course" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "course"
  USING ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.bypass_tenant', true) = 'on')
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR current_setting('app.bypass_tenant', true) = 'on');

ALTER TABLE "module" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "module"
  USING ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.bypass_tenant', true) = 'on')
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR current_setting('app.bypass_tenant', true) = 'on');

ALTER TABLE "lesson" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lesson" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "lesson"
  USING ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.bypass_tenant', true) = 'on')
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR current_setting('app.bypass_tenant', true) = 'on');

ALTER TABLE "media_asset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_asset" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "media_asset"
  USING ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.bypass_tenant', true) = 'on')
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR current_setting('app.bypass_tenant', true) = 'on');

ALTER TABLE "enrollment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrollment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "enrollment"
  USING ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.bypass_tenant', true) = 'on')
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR current_setting('app.bypass_tenant', true) = 'on');

ALTER TABLE "lesson_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lesson_progress" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "lesson_progress"
  USING ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.bypass_tenant', true) = 'on')
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR current_setting('app.bypass_tenant', true) = 'on');
