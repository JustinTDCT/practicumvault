-- Baseline schema for databases that used prisma db push before migration history.
-- Fresh databases apply this first, then subsequent migrations.

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'CANDIDATE');
CREATE TYPE "LlmProvider" AS ENUM ('ANTHROPIC', 'OPENAI', 'LOCAL');
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DISABLED');
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'ABORTED', 'TIMED_OUT');
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABORTED', 'TIMED_OUT');

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "setup_complete" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "show_countdown_timer" BOOLEAN NOT NULL DEFAULT true,
    "show_elapsed_timer" BOOLEAN NOT NULL DEFAULT true,
    "llm_provider" "LlmProvider" NOT NULL DEFAULT 'OPENAI',
    "anthropic_api_key" TEXT,
    "openai_api_key" TEXT,
    "local_llm_base_url" TEXT,
    "anthropic_model" TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
    "openai_model" TEXT NOT NULL DEFAULT 'gpt-4o',
    "local_llm_model" TEXT NOT NULL DEFAULT 'llama3.2',
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_primary_admin" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" TEXT NOT NULL,
    "position_id" TEXT,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" TEXT NOT NULL,
    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScenarioTemplate" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" TEXT NOT NULL,
    CONSTRAINT "ScenarioTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScenarioVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "time_limit_minutes" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),
    "template_id" TEXT NOT NULL,
    CONSTRAINT "ScenarioVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "assigned_by_id" TEXT NOT NULL,
    "scenario_version_id" TEXT NOT NULL,
    "position_id" TEXT,
    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "current_gate_index" INTEGER NOT NULL DEFAULT 0,
    "hints_used" INTEGER NOT NULL DEFAULT 0,
    "hints_penalty" INTEGER NOT NULL DEFAULT 0,
    "unsafe_actions" JSONB NOT NULL DEFAULT '[]',
    "gate_states" JSONB NOT NULL DEFAULT '[]',
    "score_breakdown" JSONB,
    "overallScore" INTEGER,
    "ai_recommendation" TEXT,
    "strengths" TEXT,
    "development_areas" TEXT,
    "admin_notes" TEXT NOT NULL DEFAULT '',
    "scoring_complete" BOOLEAN NOT NULL DEFAULT false,
    "organization_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "scenario_version_id" TEXT NOT NULL,
    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttemptMessage" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt_id" TEXT NOT NULL,
    CONSTRAINT "AttemptMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttemptEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt_id" TEXT NOT NULL,
    CONSTRAINT "AttemptEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_organization_id_idx" ON "User"("organization_id");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE UNIQUE INDEX "Position_organization_id_name_key" ON "Position"("organization_id", "name");
CREATE UNIQUE INDEX "ScenarioTemplate_organization_id_slug_key" ON "ScenarioTemplate"("organization_id", "slug");
CREATE UNIQUE INDEX "ScenarioVersion_template_id_version_key" ON "ScenarioVersion"("template_id", "version");
CREATE INDEX "ScenarioVersion_status_idx" ON "ScenarioVersion"("status");
CREATE INDEX "Assignment_candidate_id_status_idx" ON "Assignment"("candidate_id", "status");
CREATE INDEX "Attempt_status_idx" ON "Attempt"("status");
CREATE INDEX "Attempt_candidate_id_idx" ON "Attempt"("candidate_id");
CREATE INDEX "Attempt_started_at_idx" ON "Attempt"("started_at");
CREATE INDEX "AttemptMessage_attempt_id_created_at_idx" ON "AttemptMessage"("attempt_id", "created_at");
CREATE INDEX "AttemptEvent_attempt_id_created_at_idx" ON "AttemptEvent"("attempt_id", "created_at");

ALTER TABLE "User" ADD CONSTRAINT "User_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Position" ADD CONSTRAINT "Position_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScenarioTemplate" ADD CONSTRAINT "ScenarioTemplate_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScenarioVersion" ADD CONSTRAINT "ScenarioVersion_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "ScenarioTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_scenario_version_id_fkey" FOREIGN KEY ("scenario_version_id") REFERENCES "ScenarioVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_scenario_version_id_fkey" FOREIGN KEY ("scenario_version_id") REFERENCES "ScenarioVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttemptMessage" ADD CONSTRAINT "AttemptMessage_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttemptEvent" ADD CONSTRAINT "AttemptEvent_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
