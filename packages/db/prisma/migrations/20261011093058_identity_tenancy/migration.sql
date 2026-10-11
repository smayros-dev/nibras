-- CreateEnum
CREATE TYPE "WorkspaceType" AS ENUM ('PERSONAL', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETING');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('NONE', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'TEACHER', 'ASSISTANT', 'STUDENT', 'GUARDIAN');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'PENDING_APPROVAL', 'PENDING_GUARDIAN_CONSENT', 'SUSPENDED_NO_CONSENT', 'SUSPENDED_CONSENT_REVOKED', 'REMOVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETING', 'DELETED');

-- CreateEnum
CREATE TYPE "AbuseCategory" AS ENUM ('HARASSMENT', 'INAPPROPRIATE_CONTENT', 'IMPERSONATION', 'MINOR_SAFETY', 'OTHER');

-- CreateEnum
CREATE TYPE "AbuseReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AbuseEntityType" AS ENUM ('USER', 'MESSAGE', 'SESSION', 'COURSE');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('TERMS', 'PRIVACY', 'CODE_OF_CONDUCT', 'GUARDIAN_PARENTAL', 'RECORDING', 'AI_PROCESSING', 'WHATSAPP', 'MARKETING');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('fr', 'ar', 'en');

-- CreateEnum
CREATE TYPE "VerificationPurpose" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET', 'EMAIL_CHANGE_OLD', 'EMAIL_CHANGE_NEW');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ,
    "password_hash" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "avatar_media_id" UUID,
    "locale" "Locale" NOT NULL DEFAULT 'fr',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Tunis',
    "phone_e164" TEXT,
    "phone_verified_at" TIMESTAMPTZ,
    "birth_date" DATE,
    "platform_role" "PlatformRole" NOT NULL DEFAULT 'NONE',
    "totp_secret_enc" TEXT,
    "totp_enabled_at" TIMESTAMPTZ,
    "recovery_codes_hash" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "suspended_reason" TEXT,
    "suspended_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "device_label" TEXT NOT NULL,
    "ip" INET NOT NULL,
    "user_agent" TEXT NOT NULL,
    "last_seen_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_token" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "VerificationPurpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "payload" JSONB,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_otp" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_otp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace" (
    "id" UUID NOT NULL,
    "type" "WorkspaceType" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "suspended_reason" TEXT,
    "suspended_at" TIMESTAMPTZ,
    "owner_user_id" UUID NOT NULL,
    "country" CHAR(2),
    "default_timezone" TEXT NOT NULL,
    "default_locale" "Locale" NOT NULL,
    "logo_media_id" UUID,
    "brand_color" TEXT,
    "storage_quota_bytes" BIGINT NOT NULL,
    "storage_used_bytes" BIGINT NOT NULL DEFAULT 0,
    "settings" JSONB NOT NULL,
    "ai_enabled" BOOLEAN NOT NULL DEFAULT false,
    "allow_personal_workspaces" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "can_teach" BOOLEAN NOT NULL DEFAULT false,
    "status" "MembershipStatus" NOT NULL,
    "invited_by_user_id" UUID,
    "joined_at" TIMESTAMPTZ,
    "removed_at" TIMESTAMPTZ,
    "removal_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_student_assignment" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "teacher_user_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "assigned_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "teacher_student_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_profile" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bio" TEXT NOT NULL,
    "external_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "teacher_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "granted_by_user_id" UUID,
    "granted_by_email" CITEXT,
    "type" "ConsentType" NOT NULL,
    "version" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "granted_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "ip" INET NOT NULL,
    "user_agent" TEXT NOT NULL,
    "workspace_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "workspace_id" UUID,
    "actor_user_id" UUID,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "ip" INET,
    "user_agent" TEXT,
    "request_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abuse_report" (
    "id" UUID NOT NULL,
    "workspace_id" UUID,
    "reporter_user_id" UUID NOT NULL,
    "category" "AbuseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "entity_type" "AbuseEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "context_snapshot" JSONB NOT NULL,
    "attachments" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "AbuseReportStatus" NOT NULL,
    "assigned_to_user_id" UUID,
    "resolution" TEXT,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "abuse_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "user_status_idx" ON "user"("status");

-- CreateIndex
CREATE UNIQUE INDEX "user_session_refresh_token_hash_key" ON "user_session"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "user_session_user_id_idx" ON "user_session"("user_id");

-- CreateIndex
CREATE INDEX "user_session_family_id_idx" ON "user_session"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_token_token_hash_key" ON "verification_token"("token_hash");

-- CreateIndex
CREATE INDEX "verification_token_user_id_idx" ON "verification_token"("user_id");

-- CreateIndex
CREATE INDEX "phone_otp_user_id_idx" ON "phone_otp"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_slug_key" ON "workspace"("slug");

-- CreateIndex
CREATE INDEX "workspace_owner_user_id_idx" ON "workspace"("owner_user_id");

-- CreateIndex
CREATE INDEX "workspace_status_idx" ON "workspace"("status");

-- CreateIndex
CREATE INDEX "membership_workspace_id_role_status_idx" ON "membership"("workspace_id", "role", "status");

-- CreateIndex
CREATE INDEX "membership_user_id_idx" ON "membership"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_workspace_id_user_id_key" ON "membership"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_student_assignment_workspace_id_teacher_user_id_stu_key" ON "teacher_student_assignment"("workspace_id", "teacher_user_id", "student_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profile_workspace_id_user_id_key" ON "teacher_profile"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "consent_user_id_type_idx" ON "consent"("user_id", "type");

-- CreateIndex
CREATE INDEX "consent_workspace_id_type_idx" ON "consent"("workspace_id", "type");

-- CreateIndex
CREATE INDEX "audit_log_workspace_id_created_at_idx" ON "audit_log"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_created_at_idx" ON "audit_log"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "abuse_report_workspace_id_status_created_at_idx" ON "abuse_report"("workspace_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "abuse_report_entity_type_entity_id_idx" ON "abuse_report"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_token" ADD CONSTRAINT "verification_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_otp" ADD CONSTRAINT "phone_otp_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_student_assignment" ADD CONSTRAINT "teacher_student_assignment_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_student_assignment" ADD CONSTRAINT "teacher_student_assignment_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_student_assignment" ADD CONSTRAINT "teacher_student_assignment_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profile" ADD CONSTRAINT "teacher_profile_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profile" ADD CONSTRAINT "teacher_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abuse_report" ADD CONSTRAINT "abuse_report_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma cannot express partial indexes): at most one live guardian consent
-- per (child, workspace), PRD §11.2.
CREATE UNIQUE INDEX "consent_guardian_parental_active_key" ON "consent"("user_id", "workspace_id", "type") WHERE "type" = 'GUARDIAN_PARENTAL' AND "revoked_at" IS NULL;
