-- CreateIndex
CREATE INDEX "abuse_report_reporter_user_id_idx" ON "abuse_report"("reporter_user_id");

-- CreateIndex
CREATE INDEX "teacher_profile_user_id_idx" ON "teacher_profile"("user_id");

-- CreateIndex
CREATE INDEX "teacher_student_assignment_workspace_id_student_user_id_idx" ON "teacher_student_assignment"("workspace_id", "student_user_id");

-- CreateIndex
CREATE INDEX "teacher_student_assignment_teacher_user_id_idx" ON "teacher_student_assignment"("teacher_user_id");

-- CreateIndex
CREATE INDEX "teacher_student_assignment_student_user_id_idx" ON "teacher_student_assignment"("student_user_id");

-- ─── Hand-written (Prisma cannot express these; `migrate:check` ignores them) ──────

-- PRD §11.2 / D-O5: account-level consents (TERMS, PRIVACY, CODE_OF_CONDUCT, MARKETING) carry no
-- workspace; every other type (GUARDIAN_PARENTAL, RECORDING, AI_PROCESSING, WHATSAPP) requires one.
-- Without it a GUARDIAN_PARENTAL row with a NULL workspace would escape
-- consent_guardian_parental_active_key (NULLs never collide in a unique index).
ALTER TABLE "consent" ADD CONSTRAINT "consent_workspace_scope_check"
  CHECK (("type" IN ('TERMS', 'PRIVACY', 'CODE_OF_CONDUCT', 'MARKETING')) = ("workspace_id" IS NULL));

-- A user owns at most one live PERSONAL workspace (soft-deleted ones do not count); backs PERSONAL_WORKSPACE_EXISTS.
CREATE UNIQUE INDEX "workspace_personal_owner_key" ON "workspace"("owner_user_id")
  WHERE "type" = 'PERSONAL' AND "deleted_at" IS NULL;

-- Prisma generates scalar-list columns as nullable with an ARRAY[] default; the API never stores
-- NULL there, so forbid it. Prisma's schema diff does not compare list-column nullability, so this
-- does not show up as drift.
ALTER TABLE "user" ALTER COLUMN "recovery_codes_hash" SET DEFAULT '{}', ALTER COLUMN "recovery_codes_hash" SET NOT NULL;
ALTER TABLE "teacher_profile" ALTER COLUMN "subjects" SET DEFAULT '{}', ALTER COLUMN "subjects" SET NOT NULL;
ALTER TABLE "abuse_report" ALTER COLUMN "attachments" SET DEFAULT '{}', ALTER COLUMN "attachments" SET NOT NULL;
