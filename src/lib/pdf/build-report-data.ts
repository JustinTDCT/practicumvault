import { Attempt, ScenarioVersion, ScenarioTemplate, User, Assignment, Position } from "@prisma/client";
import { ObjectiveState, formatDuration, parseObjectiveStates } from "@/lib/attempts/service";
import { SnapshotIntegrityError, requireAttemptSnapshot } from "@/lib/attempts/snapshot";
import { ReportData } from "@/lib/pdf/report";

type AttemptWithRelations = Attempt & {
  candidate: User;
  scenarioVersion: ScenarioVersion & { template: ScenarioTemplate };
  assignment: Assignment & { position: Position | null };
};

function snapshotMeta(attempt: AttemptWithRelations) {
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

export function buildReportData(attempt: AttemptWithRelations): ReportData {
  const objectiveStates = parseObjectiveStates(attempt.gateStates);
  const completed = objectiveStates.filter((o: ObjectiveState) => o.passed).length;
  const total = objectiveStates.length || 1;
  const endAt = attempt.submittedAt ?? attempt.completedAt;
  const durationMs = endAt
    ? endAt.getTime() - attempt.startedAt.getTime()
    : Date.now() - attempt.startedAt.getTime();

  const categoryScores = Array.isArray(attempt.scoreBreakdown)
    ? (attempt.scoreBreakdown as Array<{ name: string; score: number; notes: string }>)
    : [];

  const unsafeActions = Array.isArray(attempt.unsafeActions)
    ? (attempt.unsafeActions as string[])
    : [];

  const meta = snapshotMeta(attempt);

  return {
    candidateName: attempt.candidate.fullName,
    candidateEmail: attempt.candidate.email,
    position: attempt.assignment.position?.name ?? "",
    scenarioTitle: meta.title,
    scenarioVersion: meta.version,
    scenarioSlug: meta.slug,
    startedAt: attempt.startedAt.toLocaleString(),
    completedAt: endAt?.toLocaleString() ?? "—",
    duration: formatDuration(durationMs),
    status: attempt.status,
    objectivesCompleted: `${completed}/${total}`,
    /** @deprecated */ gatesPassed: `${completed}/${total}`,
    hintsUsed: attempt.hintsUsed,
    unsafeActions,
    overallScore: attempt.overallScore,
    strengths: attempt.strengths ?? "",
    developmentAreas: attempt.developmentAreas ?? "",
    recommendation: attempt.aiRecommendation ?? "",
    adminNotes: attempt.adminNotes,
    categoryScores,
  };
}
