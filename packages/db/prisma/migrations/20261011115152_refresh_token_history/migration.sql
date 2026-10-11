-- CreateTable
CREATE TABLE "refresh_token_history" (
    "token_hash" TEXT NOT NULL,
    "session_id" UUID NOT NULL,
    "rotated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_history_pkey" PRIMARY KEY ("token_hash")
);

-- CreateIndex
CREATE INDEX "refresh_token_history_session_id_idx" ON "refresh_token_history"("session_id");

-- AddForeignKey
ALTER TABLE "refresh_token_history" ADD CONSTRAINT "refresh_token_history_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "user_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
