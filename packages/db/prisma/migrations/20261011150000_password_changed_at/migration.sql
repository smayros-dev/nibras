-- AlterTable
ALTER TABLE "user" ADD COLUMN     "password_changed_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "user_session" ADD COLUMN     "authenticated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
