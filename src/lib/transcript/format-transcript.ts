import { Attempt, AttemptMessage, ScenarioVersion, ScenarioTemplate, User } from "@prisma/client";

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

export function buildTranscriptFilename(attempt: AttemptForTranscript): string {
  const candidate = slugify(attempt.candidate.fullName || "candidate");
  const scenario = slugify(attempt.scenarioVersion.template.slug || "scenario");
  return `practicum-transcript-${candidate}-${scenario}-${attempt.id.slice(0, 8)}.txt`;
}

export function formatAttemptTranscript(attempt: AttemptForTranscript): string {
  const lines: string[] = [
    "Practicum Vault — Assessment Transcript",
    "=".repeat(48),
    "",
    `Candidate: ${attempt.candidate.fullName}`,
    `Email: ${attempt.candidate.email}`,
    `Scenario: ${attempt.scenarioVersion.template.title} (v${attempt.scenarioVersion.version})`,
    `Status: ${attempt.status}`,
    `Started: ${attempt.startedAt.toLocaleString()}`,
    `Completed: ${attempt.completedAt?.toLocaleString() ?? "—"}`,
    `Score: ${attempt.overallScore ?? "—"}/100`,
    `Hints used: ${attempt.hintsUsed}`,
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
