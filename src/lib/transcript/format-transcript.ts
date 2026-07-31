import { Attempt, AttemptMessage, ScenarioVersion, ScenarioTemplate, User } from "@prisma/client";
import { SnapshotIntegrityError, requireAttemptSnapshot } from "@/lib/attempts/snapshot";

type AttemptForTranscript = Attempt & {
  candidate: User;
  messages: AttemptMessage[];
  scenarioVersion: ScenarioVersion & { template: ScenarioTemplate };
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function snapshotMeta(attempt: AttemptForTranscript) {
  const snap = requireAttemptSnapshot(attempt);
  if (!snap.templateSlug) {
    throw new SnapshotIntegrityError(
      "Historical scenario snapshot is missing templateSlug. Run snapshot backfill.",
    );
  }
  return {
    title: snap.templateTitle,
    version: snap.versionDisplay,
    slug: snap.templateSlug,
  };
}

export function buildTranscriptFilename(attempt: AttemptForTranscript): string {
  const candidate = slugify(attempt.candidate.fullName || "candidate");
  const meta = snapshotMeta(attempt);
  const scenario = slugify(meta.slug || "scenario");
  return `practicum-transcript-${candidate}-${scenario}-${attempt.id.slice(0, 8)}.txt`;
}

export function formatAttemptTranscript(attempt: AttemptForTranscript): string {
  const meta = snapshotMeta(attempt);
  const lines: string[] = [
    "Practicum Vault — Assessment Transcript",
    "=".repeat(48),
    "",
    `Candidate: ${attempt.candidate.fullName}`,
    `Email: ${attempt.candidate.email}`,
    `Scenario: ${meta.title} (v${meta.version}) [${meta.slug}]`,
    `Status: ${attempt.status}`,
    `Started: ${attempt.startedAt.toLocaleString()}`,
    `Submitted: ${attempt.submittedAt?.toLocaleString() ?? "—"}`,
    `Completed: ${attempt.completedAt?.toLocaleString() ?? "—"}`,
    `Score: ${attempt.overallScore ?? "—"}/100`,
    `Hints used: ${attempt.hintsUsed}`,
    `Scoring model: ${attempt.scoringModel ?? "—"}`,
    `Scoring engine: ${attempt.scoringEngineVersion ?? "—"}`,
    "",
    "-".repeat(48),
    "Transcript",
    "-".repeat(48),
    "",
  ];

  for (const message of attempt.messages) {
    const role = message.role.toUpperCase();
    const timestamp = message.createdAt.toLocaleString();
    lines.push(`[${role}] ${timestamp}`);
    lines.push(message.content);
    lines.push("");
  }

  return lines.join("\n");
}
