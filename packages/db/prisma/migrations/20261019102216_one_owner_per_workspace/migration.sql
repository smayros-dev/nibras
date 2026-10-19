-- ─── Hand-written (Prisma cannot express these; `migrate:check` ignores them) ──────

-- SP1.6 F7: exactly one OWNER per workspace. Fail loudly instead of half-applying when existing
-- data already breaks the rule (fix the extra OWNER memberships by hand, then migrate again).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "membership" WHERE "role" = 'OWNER' GROUP BY "workspace_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'workspaces with several OWNER memberships exist; fix data before migrating';
  END IF;
END $$;

-- At most one OWNER membership per workspace, whatever its status (a REMOVED OWNER still counts:
-- the OWNER can never be removed, so such a row is a bug to surface, not to tolerate). Ownership
-- transfer demotes the current OWNER before promoting the new one, inside one transaction.
CREATE UNIQUE INDEX "membership_owner_per_workspace_key" ON "membership"("workspace_id")
  WHERE "role" = 'OWNER';
