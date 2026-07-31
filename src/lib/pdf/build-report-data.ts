import { Attempt, ScenarioVersion, ScenarioTemplate, User, Assignment, Position } from "@prisma/client";
import { ObjectiveState, formatDuration, parseObjectiveStates } from "@/lib/attempts/service";
import { parseScenarioSnapshot } from "@/lib/attempts/snapshot";
import { ReportData } from "@/lib/pdf/report";

type AttemptWithRelations = Attempt & {
  candidate: User;
  scenarioVersion: ScenarioVersion & { template: ScenarioTemplate };
  assignment: Assignment & { position: Position | null };
};

function snapshotMeta(attempt: AttemptWithRelations) {
  if (attempt.scenarioSnapshot) {
    try {
      const snap = parseScenarioSnapshot(attempt.scenarioSnapshot);
      return {
        title: snap.templateTitle,
        version: snap.versionDisplay,
        slug: attempt.scenarioVersion.template.slug,
      };
    } catch {
      // fall through
    }
  }
  return {
    title: attempt.scenarioVersion.template.title,
    version: attempt.scenarioVersion.version,
    slug: attempt.scenarioVersion.template.slug,
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
