import { AssignmentStatus, AttemptStatus } from "@prisma/client";

export interface CandidateAssignmentDto {
  id: string;
  status: AssignmentStatus;
  canStart: boolean;
  scenario: {
    title: string;
    displayedVersion: string;
    timeLimitMinutes: number;
  };
}

export interface CandidateActiveAttemptDto {
  id: string;
}

export interface CandidateDashboardDto {
  assignments: CandidateAssignmentDto[];
  activeAttempt: CandidateActiveAttemptDto | null;
}

export interface CandidateStartAttemptDto {
  attempt: {
    id: string;
    status: "IN_PROGRESS";
    startedAt: string;
    expiresAt: string;
  };
}

export interface CandidateAttemptDto {
  attempt: {
    id: string;
    status: AttemptStatus;
    startedAt: string;
    submittedAt: string | null;
    expiresAt: string;
    completedAt: string | null;
    timer: {
      elapsedMs: number;
      remainingMs: number;
      elapsedFormatted: string;
      remainingFormatted: string;
      expired: boolean;
      frozen: boolean;
    };
    scenarioTitle: string;
    scenarioVersion: string;
  };
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: string;
  }>;
  timerSettings: {
    showCountdown: boolean;
    showElapsed: boolean;
  };
}

/** Secret markers that must never appear in candidate-facing JSON. */
export const CANDIDATE_LEAK_MARKERS = [
  "rootCause",
  "hiddenFacts",
  "redHerrings",
  "scenarioSnapshot",
  "passCriteria",
  "requiredEvidence",
  "scoringRubric",
  "unsafeActions",
  "aiInstructions",
  "gateStates",
  "objectiveStates",
  "currentObjectiveIndex",
  "currentGateIndex",
  "classifierModel",
  "scoringModel",
  "unsafeActionRecords",
  "revealedEvidenceIds",
  "scoreBreakdown",
  "adminNotes",
] as const;

export function assertNoCandidateLeakage(serialized: string, secretMarkers: string[]): void {
  const lower = serialized.toLowerCase();
  for (const marker of secretMarkers) {
    if (lower.includes(marker.toLowerCase())) {
      throw new Error(`Candidate response leaked secret marker: ${marker}`);
    }
  }
  for (const key of CANDIDATE_LEAK_MARKERS) {
    // Allow keys only when testing marker list itself; check JSON property patterns
    if (serialized.includes(`"${key}"`) || serialized.includes(`"${key}":`)) {
      throw new Error(`Candidate response leaked field key: ${key}`);
    }
  }
}
