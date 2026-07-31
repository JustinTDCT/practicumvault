import { AttemptStatus, AssignmentStatus, TemplateStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ScenarioTemplateContent, validateTemplateContent } from "@/lib/templates/schema";
import { getAttemptContent, parseScenarioSnapshot } from "@/lib/attempts/snapshot";
import { LIMITS } from "@/lib/config/limits";
import { UnsafeActionRecord } from "@/lib/ai/types";

export interface ObjectiveState {
  objectiveId: number;
  passed: boolean;
  attempts: number;
  lastEvaluatedAt?: string;
  reasoning?: string;
}

/** @deprecated Use ObjectiveState */
export type GateState = ObjectiveState;

export async function getOrganization() {
  return prisma.organization.findFirst();
}

export async function getLatestPublishedVersion(templateId: string) {
  return prisma.scenarioVersion.findFirst({
    where: { templateId, status: TemplateStatus.PUBLISHED },
    orderBy: { publishedAt: "desc" },
  });
}

export async function getActiveAttemptForCandidate(candidateId: string) {
  await reconcileExpiredAttemptsForCandidate(candidateId);
  return prisma.attempt.findFirst({
    where: {
      candidateId,
      status: AttemptStatus.IN_PROGRESS,
    },
    include: {
      scenarioVersion: { include: { template: true } },
      assignment: true,
    },
  });
}

export function parseObjectiveStates(raw: unknown): ObjectiveState[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      objectiveId: Number(row.objectiveId ?? row.gateId),
      passed: Boolean(row.passed),
      attempts: Number(row.attempts ?? 0),
      lastEvaluatedAt: row.lastEvaluatedAt as string | undefined,
      reasoning: row.reasoning as string | undefined,
    };
  });
}

/** @deprecated Use parseObjectiveStates */
export const parseGateStates = parseObjectiveStates;

export function parseTemplateContent(raw: unknown): ScenarioTemplateContent {
  return validateTemplateContent(raw);
}

export function parseRevealedEvidenceIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string");
}

export function computeExpiresAt(startedAt: Date, timeLimitMinutes: number): Date {
  return new Date(startedAt.getTime() + timeLimitMinutes * 60 * 1000);
}

export function isAttemptExpired(expiresAt: Date): boolean {
  return new Date() >= expiresAt;
}

export function isAttemptAcceptingMessages(status: AttemptStatus): boolean {
  return status === AttemptStatus.IN_PROGRESS;
}

export type ExpireScope = {
  attemptId: string;
  organizationId?: string;
  candidateId?: string;
};

/**
 * Expire an authorized attempt. Prefer passing organizationId/candidateId
 * after access has already been established.
 */
export async function expireAttemptIfNeeded(scope: string | ExpireScope) {
  const attemptId = typeof scope === "string" ? scope : scope.attemptId;
  const organizationId = typeof scope === "string" ? undefined : scope.organizationId;
  const candidateId = typeof scope === "string" ? undefined : scope.candidateId;

  const attempt = await prisma.attempt.findFirst({
    where: {
      id: attemptId,
      ...(organizationId ? { organizationId } : {}),
      ...(candidateId ? { candidateId } : {}),
    },
  });
  if (!attempt || attempt.status !== AttemptStatus.IN_PROGRESS) return attempt;

  if (!isAttemptExpired(attempt.expiresAt)) return attempt;

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.attempt.updateMany({
      where: { id: attemptId, status: AttemptStatus.IN_PROGRESS },
      data: {
        status: AttemptStatus.TIMED_OUT,
        completedAt: new Date(),
        overallScore: 0,
        scoringComplete: true,
        aiRecommendation: "Timed out — session invalid. Candidate must start a new attempt.",
      },
    });
    if (claimed.count !== 1) {
      return tx.attempt.findUnique({ where: { id: attemptId } });
    }

    await tx.assignment.updateMany({
      where: {
        id: attempt.assignmentId,
        status: { in: [AssignmentStatus.IN_PROGRESS, AssignmentStatus.PENDING] },
      },
      data: { status: AssignmentStatus.TIMED_OUT },
    });

    const existing = await tx.attemptEvent.findFirst({
      where: { attemptId, type: "timed_out" },
      select: { id: true },
    });
    if (!existing) {
      await tx.attemptEvent.create({
        data: {
          attemptId,
          type: "timed_out",
          payload: { at: new Date().toISOString() },
        },
      });
    }

    return tx.attempt.findUnique({ where: { id: attemptId } });
  });
}

export async function reconcileExpiredAttemptsForCandidate(candidateId: string): Promise<void> {
  const expired = await prisma.attempt.findMany({
    where: {
      candidateId,
      status: AttemptStatus.IN_PROGRESS,
      expiresAt: { lte: new Date() },
    },
    select: { id: true, organizationId: true },
  });
  for (const attempt of expired) {
    await expireAttemptIfNeeded({
      attemptId: attempt.id,
      candidateId,
      organizationId: attempt.organizationId,
    });
  }
}

export async function reconcileExpiredAttempts(organizationId?: string): Promise<number> {
  const expired = await prisma.attempt.findMany({
    where: {
      status: AttemptStatus.IN_PROGRESS,
      expiresAt: { lte: new Date() },
      ...(organizationId ? { organizationId } : {}),
    },
    select: { id: true, organizationId: true },
  });
  for (const row of expired) {
    await expireAttemptIfNeeded({
      attemptId: row.id,
      organizationId: row.organizationId,
    });
  }
  return expired.length;
}

export async function abortAttempt(
  attemptId: string,
  reason: "candidate" | "admin",
  scope?: { organizationId?: string; candidateId?: string },
) {
  return prisma.$transaction(async (tx) => {
    const attempt = await tx.attempt.findFirst({
      where: {
        id: attemptId,
        ...(scope?.organizationId ? { organizationId: scope.organizationId } : {}),
        ...(scope?.candidateId ? { candidateId: scope.candidateId } : {}),
      },
    });
    if (!attempt || attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new Error("Attempt is not in progress.");
    }

    const claimed = await tx.attempt.updateMany({
      where: { id: attemptId, status: AttemptStatus.IN_PROGRESS },
      data: {
        status: AttemptStatus.ABORTED,
        completedAt: new Date(),
        overallScore: 0,
        scoringComplete: true,
        aiRecommendation: `Aborted by ${reason} — session invalid. Score: 0.`,
      },
    });
    if (claimed.count !== 1) {
      throw new Error("Attempt is not in progress.");
    }

    await tx.assignment.updateMany({
      where: {
        id: attempt.assignmentId,
        status: { in: [AssignmentStatus.IN_PROGRESS, AssignmentStatus.PENDING] },
      },
      data: { status: AssignmentStatus.ABORTED },
    });

    const existing = await tx.attemptEvent.findFirst({
      where: { attemptId, type: "aborted" },
      select: { id: true },
    });
    if (!existing) {
      await tx.attemptEvent.create({
        data: {
          attemptId,
          type: "aborted",
          payload: { by: reason, at: new Date().toISOString() },
        },
      });
    }
  });
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function getTimerState(startedAt: Date, expiresAt: Date, endAt?: Date) {
  const now = endAt ?? new Date();
  const elapsedMs = Math.max(0, now.getTime() - startedAt.getTime());
  const remainingMs = Math.max(0, expiresAt.getTime() - now.getTime());
  return {
    elapsedMs,
    remainingMs,
    elapsedFormatted: formatDuration(elapsedMs),
    remainingFormatted: formatDuration(remainingMs),
    expired: remainingMs <= 0,
    frozen: Boolean(endAt),
  };
}

export function canCandidateStartAssignment(status: AssignmentStatus): boolean {
  return (
    status === AssignmentStatus.PENDING ||
    status === AssignmentStatus.ABORTED ||
    status === AssignmentStatus.TIMED_OUT
  );
}

export function assignmentStartBlockedReason(status: AssignmentStatus): string | null {
  if (status === AssignmentStatus.COMPLETED) {
    return "This assessment has been submitted for scoring. Contact your administrator if you need another attempt.";
  }
  if (status === AssignmentStatus.IN_PROGRESS) {
    return "This assignment already has an active session in progress.";
  }
  if (!canCandidateStartAssignment(status)) {
    return "This assignment is not available to start.";
  }
  return null;
}

export async function allowAssignmentRetake(assignmentId: string, organizationId: string) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      attempts: { where: { status: AttemptStatus.IN_PROGRESS }, take: 1 },
    },
  });

  if (!assignment || assignment.organizationId !== organizationId) {
    throw new Error("Assignment not found");
  }

  if (assignment.status !== AssignmentStatus.COMPLETED) {
    throw new Error("Only submitted (completed) assignments can be reopened for a retake");
  }

  if (assignment.attempts.length > 0) {
    throw new Error("Candidate still has an active attempt on this assignment");
  }

  return prisma.assignment.update({
    where: { id: assignmentId },
    data: { status: AssignmentStatus.PENDING },
  });
}

export function getAttemptScenarioContent(attempt: {
  scenarioSnapshot: unknown;
  scenarioVersion?: { content: unknown };
}): ScenarioTemplateContent {
  return getAttemptContent(attempt);
}

export function getBoundedTranscript(
  messages: Array<{ role: string; content: string }>,
  maxChars = LIMITS.transcriptContextMaxChars,
): string {
  const parts = messages.map((m) => `[${m.role.toUpperCase()}] ${m.content}`);
  let result = "";
  for (let i = parts.length - 1; i >= 0; i--) {
    const next = parts[i] + (result ? "\n\n" + result : "");
    if (next.length > maxChars) break;
    result = next;
  }
  if (!result && parts.length > 0) {
    result = parts[parts.length - 1].slice(-maxChars);
  }
  return result;
}

export function parseUnsafeActionRecords(raw: unknown): UnsafeActionRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw as UnsafeActionRecord[];
}

export function getSnapshotFromAttempt(attempt: { scenarioSnapshot: unknown }) {
  if (!attempt.scenarioSnapshot) {
    throw new Error("Attempt missing scenario snapshot");
  }
  return parseScenarioSnapshot(attempt.scenarioSnapshot);
}
