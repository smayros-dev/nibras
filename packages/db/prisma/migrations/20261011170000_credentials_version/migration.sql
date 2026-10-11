-- AlterTable
ALTER TABLE "user" ADD COLUMN     "credentials_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "user_session" DROP COLUMN "authenticated_at",
ADD COLUMN     "credentials_version" INTEGER NOT NULL DEFAULT 0;

-- Backfill: existing sessions carry their user's current version (every user starts at 0, so
-- this is a no-op today, but keeps the invariant explicit).
UPDATE "user_session" s SET "credentials_version" = u."credentials_version"
FROM "user" u WHERE u."id" = s."user_id";
