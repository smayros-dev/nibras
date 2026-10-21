-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "InviteLinkStatus" AS ENUM ('ACTIVE', 'DISABLED', 'EXHAUSTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "GuardianLinkStatus" AS ENUM ('PENDING', 'ACTIVE', 'REFUSED', 'REVOKED');

-- CreateEnum
CREATE TYPE "GuardianRelationship" AS ENUM ('PARENT', 'LEGAL_GUARDIAN', 'OTHER');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "invitation" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "guardian_email" CITEXT,
    "birth_date" DATE,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "status" "InvitationStatus" NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "message" TEXT,
    "course_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "teacher_user_id" UUID,
    "accepted_by_user_id" UUID,
    "accepted_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "resent_count" INTEGER NOT NULL DEFAULT 0,
    "last_sent_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite_link" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "role" "MembershipRole" NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "teacher_user_id" UUID,
    "course_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "requires_approval" BOOLEAN NOT NULL,
    "max_uses" INTEGER NOT NULL,
    "uses_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ,
    "status" "InviteLinkStatus" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invite_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian_link" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "guardian_user_id" UUID,
    "guardian_email" CITEXT NOT NULL,
    "guardian_first_name" TEXT,
    "guardian_last_name" TEXT,
    "relationship" "GuardianRelationship",
    "status" "GuardianLinkStatus" NOT NULL,
    "consent_id" UUID,
    "consent_token_hash" TEXT,
    "consent_expires_at" TIMESTAMPTZ,
    "consent_sent_at" TIMESTAMPTZ,
    "consent_resent_count" INTEGER NOT NULL DEFAULT 0,
    "sessions_view_token_hash" TEXT,
    "decided_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "guardian_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_import" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL,
    "rows" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "valid_rows" INTEGER NOT NULL,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invitation_import_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_workspace_id_status_idx" ON "invitation"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "invitation_workspace_id_email_idx" ON "invitation"("workspace_id", "email");

-- CreateIndex
CREATE INDEX "invitation_invited_by_user_id_idx" ON "invitation"("invited_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invite_link_code_key" ON "invite_link"("code");

-- CreateIndex
CREATE INDEX "invite_link_workspace_id_status_idx" ON "invite_link"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "invite_link_created_by_user_id_idx" ON "invite_link"("created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_link_consent_token_hash_key" ON "guardian_link"("consent_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_link_sessions_view_token_hash_key" ON "guardian_link"("sessions_view_token_hash");

-- CreateIndex
CREATE INDEX "guardian_link_workspace_id_student_user_id_idx" ON "guardian_link"("workspace_id", "student_user_id");

-- CreateIndex
CREATE INDEX "guardian_link_guardian_user_id_idx" ON "guardian_link"("guardian_user_id");

-- CreateIndex
CREATE INDEX "guardian_link_guardian_email_idx" ON "guardian_link"("guardian_email");

-- CreateIndex
CREATE INDEX "guardian_link_consent_id_idx" ON "guardian_link"("consent_id");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_link_student_user_id_workspace_id_key" ON "guardian_link"("student_user_id", "workspace_id");

-- CreateIndex
CREATE INDEX "invitation_import_workspace_id_created_at_idx" ON "invitation_import"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "invitation_import_created_by_user_id_idx" ON "invitation_import"("created_by_user_id");

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_link" ADD CONSTRAINT "invite_link_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_link" ADD CONSTRAINT "invite_link_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_link" ADD CONSTRAINT "guardian_link_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_link" ADD CONSTRAINT "guardian_link_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_link" ADD CONSTRAINT "guardian_link_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "consent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_import" ADD CONSTRAINT "invitation_import_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_import" ADD CONSTRAINT "invitation_import_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Hand-written (Prisma cannot express these; `migrate:check` ignores them) ──────

-- SP2 (PRD §8.3.1): at most one PENDING invitation per (workspace, address); email is citext, so
-- case variants collide. ACCEPTED, EXPIRED and REVOKED rows are history and never collide. A stored
-- PENDING past expires_at still counts until the daily job (or a resend) changes it.
CREATE UNIQUE INDEX "invitation_pending_per_email_key" ON "invitation"("workspace_id", "email")
  WHERE "status" = 'PENDING';

-- Prisma generates scalar-list columns as nullable with an ARRAY[] default; the API never stores
-- NULL there, so forbid it (same rule as `identity_tenancy_constraints`).
ALTER TABLE "invitation" ALTER COLUMN "course_ids" SET DEFAULT '{}', ALTER COLUMN "course_ids" SET NOT NULL;
ALTER TABLE "invite_link" ALTER COLUMN "course_ids" SET DEFAULT '{}', ALTER COLUMN "course_ids" SET NOT NULL;

-- ─── Hand-written: tenant isolation (PRD §13.3, D-P13) ─────────────────────────────
-- The four SP2 🏢 tables get the ENABLE/FORCE pair and the `tenant_isolation` policy copied verbatim
-- from `20261011095737_rls_and_audit_privileges` (NULLIF form, see the comment there). Public token
-- routes resolve the workspace through `crossTenantDb()` (app.bypass_tenant, read-only, filtered by
-- a unique secret column: CROSS_TENANT_LOOKUP_KEYS in packages/db/src/tenant.ts) and write under
-- `withTenantTx(workspaceId)`, which this policy checks.

ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "invitation"
  USING ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.bypass_tenant', true) = 'on')
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR current_setting('app.bypass_tenant', true) = 'on');

ALTER TABLE "invite_link" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invite_link" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "invite_link"
  USING ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.bypass_tenant', true) = 'on')
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR current_setting('app.bypass_tenant', true) = 'on');

ALTER TABLE "guardian_link" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guardian_link" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "guardian_link"
  USING ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.bypass_tenant', true) = 'on')
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR current_setting('app.bypass_tenant', true) = 'on');

ALTER TABLE "invitation_import" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitation_import" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "invitation_import"
  USING ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.bypass_tenant', true) = 'on')
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR current_setting('app.bypass_tenant', true) = 'on');
