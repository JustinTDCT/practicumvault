import { generateObject, generateText } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getLanguageModel } from "@/lib/ai/provider";
import { buildObjectiveEvaluationPrompt, buildScoringPrompt } from "@/lib/ai/prompts";
import {
  ObjectiveState,
  parseObjectiveStates,
  parseTemplateContent,
} from "@/lib/attempts/service";
import { AttemptStatus, AssignmentStatus } from "@prisma/client";

const objectiveEvalSchema = z.object({
  passed: z.boolean(),
  reasoning: z.string(),
  evidenceFound: z.array(z.string()),
  missingEvidence: z.array(z.string()),
});

const scoringSchema = z.object({
  categoryScores: z.array(
    z.object({
      name: z.string(),
      score: z.number(),
      notes: z.string(),
    }),
  ),
  overallScore: z.number(),
  strengths: z.string(),
  developmentAreas: z.string(),
  recommendation: z.string(),
  unsafeActionsDetected: z.array(z.string()),
});

export async function evaluateCurrentObjective(attemptId: string): Promise<ObjectiveState[]> {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      scenarioVersion: true,
      organization: true,
    },
  });
  if (!attempt) throw new Error("Attempt not found");

  const content = parseTemplateContent(attempt.scenarioVersion.content);
  const objectiveStates = parseObjectiveStates(attempt.gateStates);
  const currentIndex = attempt.currentGateIndex;
  if (currentIndex >= content.objectives.length) return objectiveStates;

  const transcript = attempt.messages
    .map((m) => `[${m.role.toUpperCase()}] ${m.content}`)
    .join("\n\n");

  const model = getLanguageModel(attempt.organization);
  const objective = content.objectives[currentIndex];

  const { object } = await generateObject({
    model,
    schema: objectiveEvalSchema,
    prompt: buildObjectiveEvaluationPrompt(content, currentIndex, transcript),
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
      scenarioVersion: true,
      organization: true,
    },
  });
  if (!attempt) throw new Error("Attempt not found");

  const content = parseTemplateContent(attempt.scenarioVersion.content);
  const existingStates = parseObjectiveStates(attempt.gateStates);
  const transcript = attempt.messages
    .map((m) => `[${m.role.toUpperCase()}] ${m.content}`)
    .join("\n\n");

  const model = getLanguageModel(attempt.organization);
  const objectiveStates: ObjectiveState[] = [];

  for (let i = 0; i < content.objectives.length; i++) {
    const objective = content.objectives[i];
    const { object } = await generateObject({
      model,
      schema: objectiveEvalSchema,
      prompt: buildObjectiveEvaluationPrompt(content, i, transcript),
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
    },
  });

  return objectiveStates;
}

/** @deprecated Use evaluateAllObjectives */
export const evaluateAllGates = evaluateAllObjectives;

export async function finalizeAttemptScoring(attemptId: string) {
  const objectiveStates = await evaluateAllObjectives(attemptId);

  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      scenarioVersion: { include: { template: true } },
      organization: true,
      candidate: true,
      assignment: { include: { position: true } },
    },
  });
  if (!attempt) throw new Error("Attempt not found");

  const content = parseTemplateContent(attempt.scenarioVersion.content);
  const allCompleted = content.objectives.every((o) =>
    objectiveStates.find((s) => s.objectiveId === o.id)?.passed,
  );

  const transcript = attempt.messages
    .map((m) => `[${m.role.toUpperCase()}] ${m.content}`)
    .join("\n\n");

  const unsafeActions = Array.isArray(attempt.unsafeActions)
    ? (attempt.unsafeActions as string[])
    : [];

  const model = getLanguageModel(attempt.organization);
  const { object } = await generateObject({
    model,
    schema: scoringSchema,
    prompt: buildScoringPrompt(
      content,
      transcript,
      objectiveStates.map((o) => ({ objectiveId: o.objectiveId, passed: o.passed })),
      unsafeActions,
      attempt.hintsUsed,
    ),
  });

  let finalScore = object.overallScore;

  if (object.categoryScores.length > 0) {
    const weighted = object.categoryScores.reduce((sum, cs) => {
      const rubric = content.scoringRubric.categories.find((c) => c.name === cs.name);
      const weight = rubric?.weight ?? 0;
      return sum + cs.score * (weight / 100);
    }, 0);
    if (weighted > 0) {
      finalScore = Math.round(weighted);
    }
  }

  finalScore -= attempt.hintsPenalty;

  const policyViolations = await prisma.attemptEvent.count({
    where: { attemptId, type: "policy_violation" },
  });
  finalScore -= policyViolations * 5;

  const objectivesCompleted = objectiveStates.filter((o) => o.passed).length;
  const objectivesTotal = content.objectives.length;
  if (objectivesCompleted < objectivesTotal) {
    const missed = objectivesTotal - objectivesCompleted;
    finalScore -= missed * 3;
  }

  finalScore = Math.max(0, Math.min(100, Math.round(finalScore)));

  await prisma.attempt.update({
    where: { id: attemptId },
    data: {
      status: AttemptStatus.COMPLETED,
      completedAt: new Date(),
      scoreBreakdown: object.categoryScores,
      overallScore: finalScore,
      strengths: object.strengths,
      developmentAreas: object.developmentAreas,
      aiRecommendation: object.recommendation,
      unsafeActions: [...unsafeActions, ...object.unsafeActionsDetected],
      scoringComplete: true,
    },
  });

  await prisma.assignment.update({
    where: { id: attempt.assignmentId },
    data: { status: AssignmentStatus.COMPLETED },
  });

  await prisma.attemptEvent.create({
    data: {
      attemptId,
      type: "scored",
      payload: { overallScore: finalScore, allObjectivesCompleted: allCompleted },
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
}

export async function detectUnsafeAction(
  attemptId: string,
  candidateMessage: string,
): Promise<string | null> {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: { scenarioVersion: true, organization: true },
  });
  if (!attempt) return null;

  const content = parseTemplateContent(attempt.scenarioVersion.content);
  const model = getLanguageModel(attempt.organization);

  const { text } = await generateText({
    model,
    prompt: `Analyze if this candidate action in a technical simulation is unsafe or reckless.

Predefined unsafe patterns:
${content.scoringRubric.unsafeActions.map((u) => `- ${u.description}`).join("\n") || "None"}

Candidate action: "${candidateMessage}"

If unsafe, respond with JSON: {"unsafe": true, "reason": "..."}
If safe or normal diagnostic, respond with JSON: {"unsafe": false}`,
  });

  try {
    const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim());
    if (parsed.unsafe && parsed.reason) {
      const existing = Array.isArray(attempt.unsafeActions)
        ? (attempt.unsafeActions as string[])
        : [];
      if (!existing.includes(parsed.reason)) {
        await prisma.attempt.update({
          where: { id: attemptId },
          data: { unsafeActions: [...existing, parsed.reason] },
        });
        await prisma.attemptEvent.create({
          data: {
            attemptId,
            type: "unsafe_action",
            payload: { reason: parsed.reason },
          },
        });
      }
      return parsed.reason;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}
