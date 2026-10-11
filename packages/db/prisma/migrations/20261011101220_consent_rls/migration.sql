-- ─── Hand-written: RLS on consent (PRD §13.3 / D-P13, D-O5) ─────────────────────────────────────
-- Supersedes the "Consent stays outside RLS" note of 20261011095737_rls_and_audit_privileges.
-- Workspace-scoped consents (GUARDIAN_PARENTAL, RECORDING, AI_PROCESSING, WHATSAPP) concern minors'
-- data in a given workspace, so they get the same two barriers as 🏢 tables. Consent is a
-- *nullable* tenant table: account-level rows (TERMS, PRIVACY, CODE_OF_CONDUCT, MARKETING;
-- workspace_id NULL, enforced by consent_workspace_scope_check) stay visible without a tenant
-- context; workspace rows need `app.workspace_id` (tenantDb/withTenantTx) or the bypass
-- (crossTenantDb, user-filtered). The Prisma side mirrors this (NULLABLE_TENANT_MODELS in
-- packages/db/src/tenancy.ts). NULLIF: see the previous migration.

ALTER TABLE "consent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "consent"
  USING ("workspace_id" IS NULL
         OR "workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.bypass_tenant', true) = 'on')
  WITH CHECK ("workspace_id" IS NULL
              OR "workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR current_setting('app.bypass_tenant', true) = 'on');
