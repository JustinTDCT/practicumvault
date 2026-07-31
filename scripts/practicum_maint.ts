#!/usr/bin/env tsx
/**
 * Practicum Vault maintenance CLI
 *
 * Usage:
 *   npm run maint -- --password admin@example.com
 *   NEW_PASSWORD=secret npm run maint -- --password admin@example.com
 *   npm run maint -- --backfill-snapshots
 *   npm run maint -- --backfill-snapshots --dry-run
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

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let email: string | null = null;
  let backfillSnapshots = false;
  let dryRun = false;

  if (args.includes("--backfill-snapshots")) {
    backfillSnapshots = true;
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

  return { email, backfillSnapshots, dryRun };
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

async function backfillSnapshots(dryRun: boolean) {
  const attempts = await prisma.attempt.findMany({
    where: { scenarioSnapshot: { equals: null as unknown as undefined } },
    include: {
      scenarioVersion: { include: { template: true } },
      organization: true,
    },
  });

  // Prisma JSON null filter: also catch missing via raw-ish check
  const all = await prisma.attempt.findMany({
    include: {
      scenarioVersion: { include: { template: true } },
      organization: true,
    },
  });
  const missing = all.filter((a) => a.scenarioSnapshot == null);

  console.log(`Found ${missing.length} attempts without scenario snapshots.`);
  void attempts;

  let updated = 0;
  let failed = 0;

  for (const attempt of missing) {
    try {
      if (!attempt.scenarioVersion?.template || !attempt.organization) {
        console.error(`Cannot backfill attempt ${attempt.id}: missing relations`);
        failed += 1;
        continue;
      }

      const snapshot = {
        templateId: attempt.scenarioVersion.template.id,
        scenarioVersionId: attempt.scenarioVersion.id,
        versionDisplay: attempt.scenarioVersion.version,
        templateTitle: attempt.scenarioVersion.template.title,
        content: attempt.scenarioVersion.content,
        timeLimitMinutes: attempt.scenarioVersion.timeLimitMinutes,
        modelProvider: attempt.organization.llmProvider,
        modelName: resolveModelName(attempt.organization),
        simulationPromptVersion: attempt.simulationPromptVersion ?? SIMULATION_PROMPT_VERSION,
        scoringPromptVersion: attempt.scoringPromptVersion ?? SCORING_PROMPT_VERSION,
        scoringEngineVersion: attempt.scoringEngineVersion ?? SCORING_ENGINE_VERSION,
        classifierPromptVersion: CLASSIFIER_PROMPT_VERSION,
        capturedAt: attempt.startedAt.toISOString(),
        backfilled: true,
      };

      if (dryRun) {
        console.log(`[dry-run] would backfill attempt ${attempt.id}`);
      } else {
        await prisma.attempt.update({
          where: { id: attempt.id },
          data: { scenarioSnapshot: snapshot as object },
        });
        console.log(`Backfilled attempt ${attempt.id}`);
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
  const { email, backfillSnapshots: doBackfill, dryRun } = parseArgs(process.argv);

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
