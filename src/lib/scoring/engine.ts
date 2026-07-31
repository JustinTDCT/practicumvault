import { generateObject } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getLanguageModel, providerLabel } from "@/lib/ai/provider";
import { buildObjectiveEvaluationPrompt, buildScoringPrompt } from "@/lib/ai/prompts";
import {
  ObjectiveState,
  getBoundedTranscript,
  parseObjectiveStates,
  parseRevealedEvidenceIds,
  parseUnsafeActionRecords,
  getAttemptScenarioContent,
  getSnapshotFromAttempt,
} from "@/lib/attempts/service";
import { AttemptStatus, AssignmentStatus } from "@prisma/client";
import { LIMITS } from "@/lib/config/limits";
import { SCORING_ENGINE_VERSION, SCORING_PROMPT_VERSION } from "@/lib/config/versions";
import { sumUnsafePenalties } from "@/lib/scoring/unsafe-actions";
import {
  clampFinalScore,
  computeWeightedScore,
  validateCategoryScores,
} from "@/lib/scoring/validate-score";
import { ScenarioTemplateContent } from "@/lib/templates/schema";

const objectiveEvalSchema = z.object({
  passed: z.boolean(),
  reasoning: z.string(),
  evidenceFound: z.array(z.string()),
  missingEvidence: z.array(z.string()),
});

const scoringNarrativeSchema = z.object({
  categoryScores: z.array(
    z.object({
      name: z.string(),
      score: z.number(),
      notes: z.string(),
    }),
  ),
  strengths: z.string(),
  developmentAreas: z.string(),
  recommendation: z.string(),
});

export interface StructuredTurnEvent {
  candidateMessageId: string;
  classificationDecision: string;
  matchedActionId: string | null;
  evidenceIds: string[];
  responseType: string;
}

function buildStructuredContext(
  turnEvents: StructuredTurnEvent[],
  revealedEvidenceIds: string[],
  unsafeRecords: ReturnType<typeof parseUnsafeActionRecords>,
  objectiveStates: ObjectiveState[],
): string {
  return JSON.stringify(
    {
      matchedActions: turnEvents.filter((e) => e.matchedActionId).map((e) => e.matchedActionId),
      revealedEvidenceIds,
      unsafeActions: unsafeRecords.map((r) => ({
        id: r.unsafeActionId,
        penalty: r.penalty,
        messageId: r.candidateMessageId,
      })),
      objectiveStates,
      turnSummary: turnEvents.map((e) => ({
        decision: e.classificationDecision,
        action: e.matchedActionId,
        evidence: e.evidenceIds,
        responseType: e.responseType,
      })),
    },
    null,
    2,
  );
}


async function loadTurnEvents(attemptId: string): Promise<StructuredTurnEvent[]> {
  const events = await prisma.attemptEvent.findMany({
    where: { attemptId, type: "turn_classified" },
    orderBy: { createdAt: "asc" },
  });
  return events.map((e) => {
    const p = e.payload as Record<string, unknown>;
    return {
      candidateMessageId: String(p.candidateMessageId ?? ""),
      classificationDecision: String(p.classificationDecision ?? ""),
      matchedActionId: (p.matchedActionId as string | null) ?? null,
      evidenceIds: Array.isArray(p.evidenceIds) ? (p.evidenceIds as string[]) : [],
      responseType: String(p.responseType ?? ""),
    };
  });
}

export async function evaluateCurrentObjective(attemptId: string): Promise<ObjectiveState[]> {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      organization: true,
    },
  });
  if (!attempt) throw new Error("Attempt not found");

  const content = getAttemptScenarioContent(attempt);
  const objectiveStates = parseObjectiveStates(attempt.gateStates);
  const currentIndex = attempt.currentGateIndex;
  if (currentIndex >= content.objectives.length) return objectiveStates;

  const turnEvents = await loadTurnEvents(attemptId);
  const revealedEvidenceIds = parseRevealedEvidenceIds(attempt.revealedEvidenceIds);
  const unsafeRecords = parseUnsafeActionRecords(attempt.unsafeActionRecords);
  const transcript = getBoundedTranscript(attempt.messages);
  const structured = buildStructuredContext(turnEvents, revealedEvidenceIds, unsafeRecords, objectiveStates);

  const model = getLanguageModel(attempt.organization);
  const objective = content.objectives[currentIndex];

  const { object } = await generateObject({
    model,
    schema: objectiveEvalSchema,
    prompt: `${buildObjectiveEvaluationPrompt(content, currentIndex, transcript)}

Structured attempt events (primary evidence — do not invent actions not listed here):
${structured}

Rules:
- Use matched action IDs and revealed evidence IDs as primary proof
- Do not pass objectives requiring investigation based on stated conclusions alone
- Transcript is supporting context only`,
  });

  const existing = objectiveStates.find((o) => o.objectiveId === objective.id);
  const updated: ObjectiveState = {
    objectiveId: objective.id,
    passed: object.passed,
    attempts: (existing?.attempts ?? 0) + 1,
    lastEvaluatedAt: new Date().toISOString(),
    reasoning: object.reasoning,
  };

  const newStates = objectiveStates.filter((o) => o.objectiveId !== objective.id).concat(updated);

  let nextIndex = currentIndex;
  if (object.passed && currentIndex < content.objectives.length - 1) {
    nextIndex = currentIndex + 1;
  }

  await prisma.attempt.update({
    where: { id: attemptId },
    data: {
      gateStates: newStates as object,
      currentGateIndex: nextIndex,
      modelCallsCount: { increment: 1 },
    },
  });

  await prisma.attemptEvent.create({
    data: {
      attemptId,
      type: "objective_evaluated",
      payload: { objectiveId: objective.id, ...object },
    },
  });

  return newStates;
}

/** @deprecated Use evaluateCurrentObjective */
export const evaluateCurrentGate = evaluateCurrentObjective;

export async function evaluateAllObjectives(attemptId: string): Promise<ObjectiveState[]> {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      organization: true,
    },
  });
  if (!attempt) throw new Error("Attempt not found");

  const content = getAttemptScenarioContent(attempt);
  const existingStates = parseObjectiveStates(attempt.gateStates);
  const turnEvents = await loadTurnEvents(attemptId);
  const revealedEvidenceIds = parseRevealedEvidenceIds(attempt.revealedEvidenceIds);
  const unsafeRecords = parseUnsafeActionRecords(attempt.unsafeActionRecords);
  const transcript = getBoundedTranscript(attempt.messages);
  const structured = buildStructuredContext(turnEvents, revealedEvidenceIds, unsafeRecords, existingStates);

  const model = getLanguageModel(attempt.organization);
  const objectiveStates: ObjectiveState[] = [];

  for (let i = 0; i < content.objectives.length; i++) {
    const objective = content.objectives[i];
    const { object } = await generateObject({
      model,
      schema: objectiveEvalSchema,
      prompt: `${buildObjectiveEvaluationPrompt(content, i, transcript)}

Structured attempt events (primary evidence):
${structured}`,
    });

    const existing = existingStates.find((o) => o.objectiveId === objective.id);
    const updated: ObjectiveState = {
      objectiveId: objective.id,
      passed: object.passed,
      attempts: (existing?.attempts ?? 0) + 1,
      lastEvaluatedAt: new Date().toISOString(),
      reasoning: object.reasoning,
    };
    objectiveStates.push(updated);

    await prisma.attemptEvent.create({
      data: {
        attemptId,
        type: "objective_evaluated",
        payload: { objectiveId: objective.id, phase: "final", ...object },
      },
    });
  }

  const firstIncomplete = objectiveStates.findIndex((o) => !o.passed);

  await prisma.attempt.update({
    where: { id: attemptId },
    data: {
      gateStates: objectiveStates as object,
      currentGateIndex:
        firstIncomplete === -1 ? content.objectives.length - 1 : firstIncomplete,
      modelCallsCount: { increment: content.objectives.length },
    },
  });

  return objectiveStates;
}

/** @deprecated Use evaluateAllObjectives */
export const evaluateAllGates = evaluateAllObjectives;

async function generateValidatedScoringNarrative(
  attemptId: string,
  content: ScenarioTemplateContent,
  transcript: string,
  objectiveStates: ObjectiveState[],
  unsafeDescriptions: string[],
  hintsUsed: number,
  structured: string,
  retryCount: number,
): Promise<z.infer<typeof scoringNarrativeSchema>> {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: { organization: true },
  });
  if (!attempt) throw new Error("Attempt not found");

  const model = getLanguageModel(attempt.organization);

  try {
    const { object } = await generateObject({
      model,
      schema: scoringNarrativeSchema,
      prompt: `${buildScoringPrompt(
        content,
        transcript,
        objectiveStates.map((o) => ({ objectiveId: o.objectiveId, passed: o.passed })),
        unsafeDescriptions,
        hintsUsed,
      )}

Structured attempt events (do not invent actions or evidence beyond this):
${structured}

Provide narrative fields and category score estimates. Penalties are applied server-side.`,
    });

    validateCategoryScores(content, object.categoryScores);
    return object;
  } catch (err) {
    if (retryCount >= LIMITS.scoringMaxRetries) {
      throw err;
    }
    return generateValidatedScoringNarrative(
      attemptId,
      content,
      transcript,
      objectiveStates,
      unsafeDescriptions,
      hintsUsed,
      structured,
      retryCount + 1,
    );
  }
}

export async function scoreAttempt(attemptId: string, options?: { rescore?: boolean }) {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      organization: true,
      candidate: true,
      assignment: { include: { position: true } },
      scenarioVersion: { include: { template: true } },
    },
  });
  if (!attempt) throw new Error("Attempt not found");

  if (
    !options?.rescore &&
    (attempt.status === AttemptStatus.COMPLETED || attempt.status === AttemptStatus.SCORING)
  ) {
    return attempt;
  }

  if (!options?.rescore) {
    if (
      attempt.status !== AttemptStatus.SUBMITTED &&
      attempt.status !== AttemptStatus.SCORING_FAILED
    ) {
      throw new Error("Attempt must be submitted before scoring");
    }
  } else if (!attempt.submittedAt) {
    throw new Error("Attempt has not been submitted");
  }

  await prisma.attempt.update({
    where: { id: attemptId },
    data: { status: AttemptStatus.SCORING, scoringAttempts: { increment: 1 } },
  });

  try {
    const objectiveStates = await evaluateAllObjectives(attemptId);
    const refreshed = await prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        organization: true,
      },
    });
    if (!refreshed) throw new Error("Attempt not found");

    const content = getAttemptScenarioContent(refreshed);
    const snapshot = getSnapshotFromAttempt(refreshed);
    const turnEvents = await loadTurnEvents(attemptId);
    const revealedEvidenceIds = parseRevealedEvidenceIds(refreshed.revealedEvidenceIds);
    const unsafeRecords = parseUnsafeActionRecords(refreshed.unsafeActionRecords);
    const transcript = getBoundedTranscript(refreshed.messages);
    const structured = buildStructuredContext(
      turnEvents,
      revealedEvidenceIds,
      unsafeRecords,
      objectiveStates,
    );

    const narrative = await generateValidatedScoringNarrative(
      attemptId,
      content,
      transcript,
      objectiveStates,
      unsafeRecords.map((r) => r.description),
      refreshed.hintsUsed,
      structured,
      0,
    );

    const validatedCategories = validateCategoryScores(content, narrative.categoryScores);
    let finalScore = computeWeightedScore(content, validatedCategories);

    finalScore -= refreshed.hintsPenalty;

    const policyViolations = await prisma.attemptEvent.count({
      where: { attemptId, type: "policy_violation" },
    });
    finalScore -= policyViolations * 5;
    finalScore -= sumUnsafePenalties(unsafeRecords);

    const objectivesCompleted = objectiveStates.filter((o) => o.passed).length;
    const objectivesTotal = content.objectives.length;
    if (objectivesCompleted < objectivesTotal) {
      finalScore -= (objectivesTotal - objectivesCompleted) * 3;
    }

    finalScore = clampFinalScore(finalScore);

    const modelName =
      refreshed.organization.llmProvider === "ANTHROPIC"
        ? refreshed.organization.anthropicModel
        : refreshed.organization.llmProvider === "OPENAI"
          ? refreshed.organization.openaiModel
          : refreshed.organization.localLlmModel;

    await prisma.attempt.update({
      where: { id: attemptId },
      data: {
        status: AttemptStatus.COMPLETED,
        completedAt: refreshed.completedAt ?? new Date(),
        scoreBreakdown: validatedCategories,
        overallScore: finalScore,
        strengths: narrative.strengths,
        developmentAreas: narrative.developmentAreas,
        aiRecommendation: narrative.recommendation,
        unsafeActions: unsafeRecords.map((r) => r.description),
        scoringComplete: true,
        scoringModel: `${providerLabel(refreshed.organization.llmProvider)}/${modelName}`,
        scoringPromptVersion: snapshot.scoringPromptVersion,
        scoringEngineVersion: SCORING_ENGINE_VERSION,
      },
    });

    await prisma.assignment.update({
      where: { id: refreshed.assignmentId },
      data: { status: AssignmentStatus.COMPLETED },
    });

    await prisma.attemptEvent.create({
      data: {
        attemptId,
        type: "scored",
        payload: {
          overallScore: finalScore,
          scoringEngineVersion: SCORING_ENGINE_VERSION,
          scoringPromptVersion: SCORING_PROMPT_VERSION,
        },
      },
    });

    return prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        candidate: true,
        scenarioVersion: { include: { template: true } },
        assignment: { include: { position: true } },
      },
    });
  } catch (err) {
    await prisma.attempt.update({
      where: { id: attemptId },
      data: {
        status: AttemptStatus.SCORING_FAILED,
        scoringComplete: false,
      },
    });
    await prisma.attemptEvent.create({
      data: {
        attemptId,
        type: "scoring_failed",
        payload: { error: err instanceof Error ? err.message : "Unknown scoring error" },
      },
    });
    throw err;
  }
}

export async function submitAttempt(attemptId: string) {
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const attempt = await tx.attempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new Error("Attempt not found");
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      return attempt;
    }

    return tx.attempt.update({
      where: { id: attemptId, status: AttemptStatus.IN_PROGRESS },
      data: {
        status: AttemptStatus.SUBMITTED,
        submittedAt: now,
        completedAt: now,
      },
    });
  });

  if (updated.status === AttemptStatus.SUBMITTED) {
    await prisma.attemptEvent.create({
      data: {
        attemptId,
        type: "submitted",
        payload: { submittedAt: now.toISOString() },
      },
    });
    await scoreAttempt(attemptId);
  }

  return updated;
}

/** @deprecated Use submitAttempt + scoreAttempt */
export async function finalizeAttemptScoring(attemptId: string) {
  await submitAttempt(attemptId);
  return prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      candidate: true,
      scenarioVersion: { include: { template: true } },
      assignment: { include: { position: true } },
    },
  });
}

export async function rescoreAttempt(attemptId: string, organizationId: string) {
  const attempt = await prisma.attempt.findFirst({
    where: { id: attemptId, organizationId },
  });
  if (!attempt) throw new Error("Attempt not found");
  if (!attempt.submittedAt) throw new Error("Attempt has not been submitted");

  return scoreAttempt(attemptId, { rescore: true });
}
