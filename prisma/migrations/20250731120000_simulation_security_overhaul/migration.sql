-- AlterEnum
BEGIN;
CREATE TYPE "AttemptStatus_new" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'SCORING', 'COMPLETED', 'SCORING_FAILED', 'ABORTED', 'TIMED_OUT');
ALTER TABLE "Attempt" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Attempt" ALTER COLUMN "status" TYPE "AttemptStatus_new" USING ("status"::text::"AttemptStatus_new");
ALTER TYPE "AttemptStatus" RENAME TO "AttemptStatus_old";
ALTER TYPE "AttemptStatus_new" RENAME TO "AttemptStatus";
DROP TYPE "AttemptStatus_old";
ALTER TABLE "Attempt" ALTER COLUMN "status" SET DEFAULT 'IN_PROGRESS';
COMMIT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Attempt" ADD COLUMN "submitted_at" TIMESTAMP(3),
ADD COLUMN "unsafe_action_records" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "scenario_snapshot" JSONB,
ADD COLUMN "revealed_evidence_ids" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "model_calls_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "message_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "classifier_model" TEXT,
ADD COLUMN "responder_model" TEXT,
ADD COLUMN "scoring_model" TEXT,
ADD COLUMN "simulation_prompt_version" TEXT,
ADD COLUMN "scoring_prompt_version" TEXT,
ADD COLUMN "scoring_engine_version" TEXT,
ADD COLUMN "scoring_attempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Attempt_candidate_id_status_idx" ON "Attempt"("candidate_id", "status");

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip_address" TEXT,
    "success" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_attempts_email_created_at_idx" ON "login_attempts"("email", "created_at");
