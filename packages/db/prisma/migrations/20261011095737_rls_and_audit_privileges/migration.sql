-- ─── Hand-written: tenant isolation (PRD §13.3, D-P13) and append-only audit log (AC-GDPR-05) ──
-- Prisma models neither RLS nor privileges, so `migrate:check` ignores everything below.

-- Row-level security on every 🏢 table, the second barrier behind the `tenantDb` extension
-- (packages/db/src/tenant.ts). The API connects as app_user (no BYPASSRLS), so without
-- `app.workspace_id` it sees 0 rows; FORCE also binds the table owner (app_system has BYPASSRLS
-- and is unaffected). `crossTenantDb()` sets `app.bypass_tenant = 'on'` (transaction-local).
--
-- Deviation from the planned policy text: `NULLIF(…, '')`. Once a session has run
-- `set_config('app.workspace_id', …, true)`, Postgres resets the placeholder to '' (not NULL) at
-- transaction end, and `''::uuid` raises "invalid input syntax for type uuid" on every later query of
-- that pooled connection that lacks a context. NULLIF keeps the "no context = 0 rows" contract.
--
-- Later plans copy the ENABLE/FORCE pair and this policy for each new 🏢 table in their own migration.
--
-- Consent is deliberately NOT under RLS (decision recorded for D-P13): PRD §11.2 does not mark it 🏢,
-- account-level types (TERMS, PRIVACY, CODE_OF_CONDUCT, MARKETING) have workspace_id NULL, and every
-- SP1 access is by the data subject's user_id (`/me/consents`, account gates). Because `tenantDb`
-- only sets `app.workspace_id` for TENANT_MODELS operations, a policy here would silently hide
-- workspace-scoped consents from every non-tenant path instead of failing loudly. SP2 (guardian
-- consent, GuardianLink 🏢) revisits it together with a Prisma-side rule for nullable workspace_id.

ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "membership"
  USING ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.bypass_tenant', true) = 'on')
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR current_setting('app.bypass_tenant', true) = 'on');

ALTER TABLE "teacher_student_assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_student_assignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "teacher_student_assignment"
  USING ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.bypass_tenant', true) = 'on')
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR current_setting('app.bypass_tenant', true) = 'on');

ALTER TABLE "teacher_profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_profile" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "teacher_profile"
  USING ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.bypass_tenant', true) = 'on')
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR current_setting('app.bypass_tenant', true) = 'on');

-- Audit log is append-only for the API role (§8.16.3, AC-GDPR-05): it keeps SELECT and INSERT from
-- the init migration's default privileges. app_system (owner, worker, retention jobs) is unaffected.
REVOKE UPDATE, DELETE ON "audit_log" FROM app_user;
