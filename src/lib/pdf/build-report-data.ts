import { Attempt, ScenarioVersion, ScenarioTemplate, User, Assignment, Position } from "@prisma/client";
import { ObjectiveState, formatDuration, parseObjectiveStates } from "@/lib/attempts/service";
import { ReportData } from "@/lib/pdf/report";

type AttemptWithRelations = Attempt & {
  candidate: User;
  scenarioVersion: ScenarioVersion & { template: ScenarioTemplate };
  assignment: Assignment & { position: Position | null };
};

export function buildReportData(attempt: AttemptWithRelations): ReportData {
  const objectiveStates = parseObjectiveStates(attempt.gateStates);
  const completed = objectiveStates.filter((o: ObjectiveState) => o.passed).length;
  const total = objectiveStates.length || 1;
  const durationMs = attempt.completedAt
    ? attempt.completedAt.getTime() - attempt.startedAt.getTime()
    : Date.now() - attempt.startedAt.getTime();

  const categoryScores = Array.isArray(attempt.scoreBreakdown)
    ? (attempt.scoreBreakdown as Array<{ name: string; score: number; notes: string }>)
    : [];

  const unsafeActions = Array.isArray(attempt.unsafeActions)
    ? (attempt.unsafeActions as string[])
    : [];

  return {
    candidateName: attempt.candidate.fullName,
    candidateEmail: attempt.candidate.email,
    position: attempt.assignment.position?.name ?? "",
    scenarioTitle: attempt.scenarioVersion.template.title,
    scenarioVersion: attempt.scenarioVersion.version,
    scenarioSlug: attempt.scenarioVersion.template.slug,
    startedAt: attempt.startedAt.toLocaleString(),
    completedAt: attempt.completedAt?.toLocaleString() ?? "—",
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
