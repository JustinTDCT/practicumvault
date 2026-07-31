-- AlterTable Attempt
ALTER TABLE "Attempt" ADD COLUMN IF NOT EXISTS "last_scoring_failure" JSONB;

-- AlterTable AttemptMessage
ALTER TABLE "AttemptMessage" ADD COLUMN IF NOT EXISTS "turn_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "AttemptMessage_attempt_id_turn_id_role_key"
ON "AttemptMessage" ("attempt_id", "turn_id", "role");

CREATE INDEX IF NOT EXISTS "AttemptMessage_attempt_id_turn_id_idx"
ON "AttemptMessage" ("attempt_id", "turn_id");

-- Ensure login IP index exists (also in runtime_integrity; IF NOT EXISTS is safe)
CREATE INDEX IF NOT EXISTS "login_attempts_ip_address_created_at_idx"
ON "login_attempts" ("ip_address", "created_at");

-- Login rate buckets for bounded storage
CREATE TABLE IF NOT EXISTS "login_rate_buckets" (
    "id" TEXT NOT NULL,
    "bucket_key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_rate_buckets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "login_rate_buckets_bucket_key_window_start_key"
ON "login_rate_buckets" ("bucket_key", "window_start");

CREATE INDEX IF NOT EXISTS "login_rate_buckets_window_start_idx"
ON "login_rate_buckets" ("window_start");
