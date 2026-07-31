#!/usr/bin/env tsx
/**
 * Practicum Vault maintenance CLI
 *
 * Usage:
 *   npm run maint -- --password admin@example.com
 *   NEW_PASSWORD=secret npm run maint -- --password admin@example.com
 *   npm run maint -- --backfill-snapshots
 *   npm run maint -- --backfill-snapshots --dry-run
 *   npm run maint -- --migration-status
 */

import { PrismaClient, LlmProvider } from "@prisma/client";
import bcrypt from "bcryptjs";
import readline from "readline";
import { spawnSync } from "child_process";
import {
  CLASSIFIER_PROMPT_VERSION,
  SCORING_ENGINE_VERSION,
  SCORING_PROMPT_VERSION,
  SIMULATION_PROMPT_VERSION,
} from "../src/lib/config/versions";

const prisma = new PrismaClient();

const RUNTIME_INDEXES = [
  "Attempt_one_active_per_candidate",
  "Assignment_one_in_progress_per_candidate",
] as const;

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let email: string | null = null;
  let backfillSnapshots = false;
  let migrationStatus = false;
  let dryRun = false;

  if (args.includes("--backfill-snapshots")) {
    backfillSnapshots = true;
  }
  if (args.includes("--migration-status")) {
    migrationStatus = true;
  }
  if (args.includes("--dry-run")) {
    dryRun = true;
  }

  if (args.includes("--password")) {
    const idx = args.indexOf("--password");
    const next = args[idx + 1];
    if (next && !next.startsWith("--")) {
      email = next.replace(/^--/, "");
    } else {
      const emailArg = args.find((a) => a.includes("@"));
      email = emailArg?.replace(/^--/, "") ?? null;
    }
  }

  return { email, backfillSnapshots, migrationStatus, dryRun };
}

async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    console.error(
      "Interactive password entry requires a TTY. Set NEW_PASSWORD in the environment instead.",
    );
    process.exit(1);
  }

  process.stdout.write(question);
  spawnSync("stty", ["-echo"], { stdio: "inherit" });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question("", (value) => {
      rl.close();
      resolve(value);
    });
  });

  spawnSync("stty", ["echo"], { stdio: "inherit" });
  process.stdout.write("\n");
  return answer;
}

async function resetPassword(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  let password = process.env.NEW_PASSWORD;
  if (!password) {
    password = await promptHidden("New password (min 8 chars, hidden): ");
  }

  if (!password || password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(password, 12),
      sessionVersion: { increment: 1 },
    },
  });

  console.log(`Password reset for ${user.email} (${user.fullName}, ${user.role}). All sessions revoked.`);
}

function resolveModelName(org: {
  llmProvider: LlmProvider;
  anthropicModel: string;
  openaiModel: string;
  localLlmModel: string;
}): string {
  switch (org.llmProvider) {
    case LlmProvider.ANTHROPIC:
      return org.anthropicModel;
    case LlmProvider.OPENAI:
      return org.openaiModel;
    case LlmProvider.LOCAL:
      return org.localLlmModel;
    default:
      return org.openaiModel;
  }
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS exists`,
    name,
  );
  return Boolean(rows[0]?.exists);
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    ) AS exists`,
    table,
    column,
  );
  return Boolean(rows[0]?.exists);
}

async function indexExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = $1
    ) AS exists`,
    name,
  );
  return Boolean(rows[0]?.exists);
}

async function reportMigrationStatus() {
  const migrationsTable = await tableExists("_prisma_migrations");
  console.log(`_prisma_migrations exists: ${migrationsTable}`);

  let recorded: string[] = [];
  if (migrationsTable) {
    const rows = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
      `SELECT migration_name FROM _prisma_migrations ORDER BY finished_at NULLS LAST, migration_name`,
    );
    recorded = rows.map((r) => r.migration_name);
    console.log(`Recorded migrations (${recorded.length}):`);
    for (const name of recorded) {
      console.log(`  - ${name}`);
    }
  } else {
    console.log("Recorded migrations: (none — table missing)");
  }

  const overhaulColumns = {
    scenario_snapshot: await columnExists("Attempt", "scenario_snapshot"),
    session_version: await columnExists("User", "session_version"),
    login_attempts: await tableExists("login_attempts"),
  };
  console.log("Overhaul columns/tables:");
  console.log(`  Attempt.scenario_snapshot: ${overhaulColumns.scenario_snapshot}`);
  console.log(`  User.session_version: ${overhaulColumns.session_version}`);
  console.log(`  login_attempts: ${overhaulColumns.login_attempts}`);

  const indexes: Record<string, boolean> = {};
  for (const name of RUNTIME_INDEXES) {
    indexes[name] = await indexExists(name);
    console.log(`Partial unique index ${name}: ${indexes[name]}`);
  }

  const loginIpIndex = await indexExists("login_attempts_ip_address_created_at_idx");
  console.log(`Login IP index login_attempts_ip_address_created_at_idx: ${loginIpIndex}`);

  const hasBaseline = recorded.includes("20240701000000_baseline");
  const hasOverhaul = recorded.includes("20250731120000_simulation_security_overhaul");
  const hasRuntime = recorded.includes("20250731140000_runtime_integrity");
  const bothRuntimeIndexes = RUNTIME_INDEXES.every((n) => indexes[n]);
  const overhaulPresent =
    overhaulColumns.scenario_snapshot &&
    overhaulColumns.session_version &&
    overhaulColumns.login_attempts;

  let next = "";
  if (!migrationsTable || recorded.length === 0) {
    if (!overhaulPresent) {
      next =
        "Empty or pre-overhaul DB without history: run `npx prisma migrate deploy` (empty DB), OR for original db-push schema: `npx prisma migrate resolve --applied 20240701000000_baseline` then `npx prisma migrate deploy`. See docs/MIGRATIONS.md §1–2.";
    } else {
      next =
        "Overhaul schema via db push, no history: `npx prisma migrate resolve --applied 20240701000000_baseline` then `npx prisma migrate resolve --applied 20250731120000_simulation_security_overhaul` then `npx prisma migrate deploy`. Do NOT mark runtime_integrity applied until indexes verify. See docs/MIGRATIONS.md §3.";
    }
  } else if (!hasBaseline && overhaulPresent) {
    next =
      "Record baseline then deploy: `npx prisma migrate resolve --applied 20240701000000_baseline` then `npx prisma migrate deploy`.";
  } else if (hasOverhaul && !hasRuntime) {
    next =
      "Run `npx prisma migrate deploy` to apply runtime_integrity (creates partial unique indexes). Verify with this command afterward.";
  } else if (hasRuntime && !bothRuntimeIndexes) {
    next =
      "DANGER: runtime_integrity is recorded but indexes are missing. Do NOT mark it applied again. Create the missing indexes from prisma/migrations/20250731140000_runtime_integrity/migration.sql, then re-run this status check.";
  } else if (!bothRuntimeIndexes) {
    next = "Run `npx prisma migrate deploy`, then re-run this status check.";
  } else if (!loginIpIndex) {
    next = "Run `npx prisma migrate deploy` to apply remaining migrations (login IP index / later).";
  } else {
    next = "Database appears current. No migration action required.";
  }

  console.log("");
  console.log(`Exact safe next command / guidance:`);
  console.log(next);
}

async function backfillSnapshots(dryRun: boolean) {
  const all = await prisma.attempt.findMany({
    include: {
      scenarioVersion: { include: { template: true } },
      organization: true,
    },
  });
  const needing = all.filter((a) => {
    if (a.scenarioSnapshot == null) return true;
    const snap = a.scenarioSnapshot as { templateSlug?: string };
    return !snap.templateSlug;
  });

  console.log(`Found ${needing.length} attempts needing snapshot/slug backfill.`);

  let updated = 0;
  let failed = 0;

  for (const attempt of needing) {
    try {
      if (!attempt.scenarioVersion?.template || !attempt.organization) {
        console.error(`Cannot backfill attempt ${attempt.id}: missing relations`);
        failed += 1;
        continue;
      }

      const existing =
        attempt.scenarioSnapshot && typeof attempt.scenarioSnapshot === "object"
          ? (attempt.scenarioSnapshot as Record<string, unknown>)
          : null;

      const snapshot = {
        ...(existing ?? {}),
        templateId: attempt.scenarioVersion.template.id,
        templateSlug: attempt.scenarioVersion.template.slug,
        scenarioVersionId: attempt.scenarioVersion.id,
        versionDisplay:
          (existing?.versionDisplay as string | undefined) ?? attempt.scenarioVersion.version,
        templateTitle:
          (existing?.templateTitle as string | undefined) ?? attempt.scenarioVersion.template.title,
        content: existing?.content ?? attempt.scenarioVersion.content,
        timeLimitMinutes:
          (existing?.timeLimitMinutes as number | undefined) ??
          attempt.scenarioVersion.timeLimitMinutes,
        modelProvider:
          (existing?.modelProvider as LlmProvider | undefined) ?? attempt.organization.llmProvider,
        modelName:
          (existing?.modelName as string | undefined) ?? resolveModelName(attempt.organization),
        simulationPromptVersion:
          (existing?.simulationPromptVersion as string | undefined) ??
          attempt.simulationPromptVersion ??
          SIMULATION_PROMPT_VERSION,
        scoringPromptVersion:
          (existing?.scoringPromptVersion as string | undefined) ??
          attempt.scoringPromptVersion ??
          SCORING_PROMPT_VERSION,
        scoringEngineVersion:
          (existing?.scoringEngineVersion as string | undefined) ??
          attempt.scoringEngineVersion ??
          SCORING_ENGINE_VERSION,
        classifierPromptVersion:
          (existing?.classifierPromptVersion as string | undefined) ?? CLASSIFIER_PROMPT_VERSION,
        capturedAt:
          (existing?.capturedAt as string | undefined) ?? attempt.startedAt.toISOString(),
        backfilled: true,
      };

      if (dryRun) {
        console.log(`[dry-run] would backfill attempt ${attempt.id} slug=${snapshot.templateSlug}`);
      } else {
        await prisma.attempt.update({
          where: { id: attempt.id },
          data: { scenarioSnapshot: snapshot as object },
        });
        console.log(`Backfilled attempt ${attempt.id} slug=${snapshot.templateSlug}`);
      }
      updated += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `Failed attempt ${attempt.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `Backfill ${dryRun ? "dry-run " : ""}complete. updated=${updated} failed=${failed}`,
  );
}

async function main() {
  const {
    email,
    backfillSnapshots: doBackfill,
    migrationStatus,
    dryRun,
  } = parseArgs(process.argv);

  if (migrationStatus) {
    await reportMigrationStatus();
    return;
  }

  if (doBackfill) {
    await backfillSnapshots(dryRun);
    return;
  }

  if (!email) {
    console.log(`
Practicum Vault Maintenance CLI

Commands:
  npm run maint -- --password <email>
  npm run maint -- --backfill-snapshots
  npm run maint -- --backfill-snapshots --dry-run
  npm run maint -- --migration-status

Environment:
  NEW_PASSWORD  Recommended non-interactive password (no terminal echo)
  DATABASE_URL  PostgreSQL connection string
`);
    process.exit(0);
  }

  await resetPassword(email);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
