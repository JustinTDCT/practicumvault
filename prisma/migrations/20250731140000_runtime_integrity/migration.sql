-- Partial unique index: one active scoring-lifecycle attempt per candidate
CREATE UNIQUE INDEX IF NOT EXISTS "Attempt_one_active_per_candidate"
ON "Attempt" ("candidate_id")
WHERE "status" IN ('IN_PROGRESS', 'SUBMITTED', 'SCORING');

-- One IN_PROGRESS assignment per candidate (blocks concurrent starts across assignments)
CREATE UNIQUE INDEX IF NOT EXISTS "Assignment_one_in_progress_per_candidate"
ON "Assignment" ("candidate_id")
WHERE "status" = 'IN_PROGRESS';

-- Login attempt IP/time index for rate limiting
CREATE INDEX IF NOT EXISTS "login_attempts_ip_address_created_at_idx"
ON "login_attempts" ("ip_address", "created_at");
