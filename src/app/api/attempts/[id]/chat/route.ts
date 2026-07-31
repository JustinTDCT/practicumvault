import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatModelLabel, getLanguageModelForAttempt } from "@/lib/ai/provider";
import {
  ANSWER_SEEKING_REFUSAL,
  DELEGATION_REFUSAL,
  PROMPT_ATTACK_REFUSAL,
  classifyCandidateIntent,
  findMatchingAction,
} from "@/lib/ai/classifier";
import {
  formatReferenceResponse,
  resolveResponseType,
} from "@/lib/ai/simulation";
import { generateGroundedSimulationResponse } from "@/lib/ai/grounded-simulation";
import { validateClassifiedAction } from "@/lib/ai/validate-action";
import { TurnStructuredRecord } from "@/lib/ai/types";
import { createPolicyViolationStreamResponse } from "@/lib/ai/cheat-detection";
import { ModelCallLimitError } from "@/lib/ai/provider-calls";
import {
  expireAttemptIfNeeded,
  getAttemptScenarioContent,
  getSnapshotFromAttempt,
  isAttemptAcceptingMessages,
  parseRevealedEvidenceIds,
  parseUnsafeActionRecords,
} from "@/lib/attempts/service";
import { detectUnsafeActionDeterministic } from "@/lib/scoring/unsafe-actions";
import { evaluateCurrentObjective, submitAttempt } from "@/lib/scoring/engine";
import {
  CANDIDATE_SCORING_FAILURE_MESSAGE,
  PublicScoringError,
} from "@/lib/scoring/public-error";
import { LIMITS, POLICY_VIOLATION_PENALTY } from "@/lib/config/limits";
import { logSafeError, safeErrorName } from "@/lib/security/safe-log";
import { AttemptStatus, UserRole, Prisma } from "@prisma/client";

const TURN_PROCESSING_FAILURE =
  "The simulation could not process that action. Submit the specific action again.";

type ChatAttempt = Prisma.AttemptGetPayload<{
  include: {
    messages: true;
    scenarioVersion: { include: { template: true } };
    organization: true;
  };
}>;

async function loadChatAttempt(attemptId: string, candidateId: string, organizationId: string): Promise<ChatAttempt | null> {
  return prisma.attempt.findFirst({
    where: { id: attemptId, candidateId, organizationId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      scenarioVersion: { include: { template: true } },
      organization: true,
    },
  });
}

function checkRateLimit(timestamps: number[], windowMs: number, max: number): boolean {
  const now = Date.now();
  const recent = timestamps.filter((t) => now - t < windowMs);
  return recent.length < max;
}

function classifyTurnFailure(err: unknown): { category: string; retryable: boolean } {
  if (err instanceof ModelCallLimitError) {
    return { category: "model_call_limit", retryable: false };
  }
  if (err instanceof Error) {
    const name = err.name || "Error";
    if (/timeout/i.test(name) || /timeout/i.test(err.message)) {
      return { category: "provider_timeout", retryable: true };
    }
  }
  return { category: "provider_error", retryable: true };
}

async function persistTurnAssistant(
  attemptId: string,
  turnId: string,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const trimmed = content.trim();
  if (!trimmed) return "";

  try {
    await prisma.attemptMessage.create({
      data: {
        attemptId,
        turnId,
        role: "assistant",
        content: trimmed,
        metadata: (metadata as object | undefined) ?? undefined,
      },
    });
    return trimmed;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.attemptMessage.findFirst({
        where: { attemptId, turnId, role: "assistant" },
      });
      return existing?.content ?? trimmed;
    }
    throw err;
  }
}

async function finishTurnAsProcessingFailure(options: {
  attemptId: string;
  turnId: string;
  candidateMessageId: string;
  err: unknown;
  modelLabel?: string | null;
}): Promise<Response> {
  const { category, retryable } = classifyTurnFailure(options.err);
  logSafeError("chat.turn_processing_failed", {
    attemptId: options.attemptId,
    category,
    errorName: safeErrorName(options.err),
    retryable,
    correlationId: options.turnId,
  });

  const existingEvent = await prisma.attemptEvent.findFirst({
    where: {
      attemptId: options.attemptId,
      type: "turn_processing_failed",
      payload: { path: ["turnId"], equals: options.turnId },
    },
  });
  if (!existingEvent) {
    await prisma.attemptEvent.create({
      data: {
        attemptId: options.attemptId,
        type: "turn_processing_failed",
        payload: {
          turnId: options.turnId,
          candidateMessageId: options.candidateMessageId,
          category,
          retryable,
          model: options.modelLabel ?? null,
        },
      },
    });
  }

  const text = await persistTurnAssistant(
    options.attemptId,
    options.turnId,
    TURN_PROCESSING_FAILURE,
    {
      type: "processing_failure",
      category,
      retryable,
      turnId: options.turnId,
    },
  );

  return createPolicyViolationStreamResponse(text || TURN_PROCESSING_FAILURE);
}

async function recordPolicyViolationIfNeeded(
  attemptId: string,
  turnId: string,
  candidateMessageId: string,
  decision: string,
): Promise<void> {
  if (
    decision !== "DELEGATION_REQUEST" &&
    decision !== "ANSWER_SEEKING" &&
    decision !== "META_OR_PROMPT_ATTACK"
  ) {
    return;
  }

  const existing = await prisma.attemptEvent.findFirst({
    where: {
      attemptId,
      type: "policy_violation",
      payload: { path: ["turnId"], equals: turnId },
    },
  });
  if (existing) return;

  await prisma.attemptEvent.create({
    data: {
      attemptId,
      type: "policy_violation",
      payload: {
        turnId,
        candidateMessageId,
        category: decision,
        penalty: POLICY_VIOLATION_PENALTY,
      },
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth([UserRole.CANDIDATE]);
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id: attemptId } = await params;
  const body = await request.json();
  const { message, action, turnId: clientTurnId } = body as {
    message?: string;
    action?: string;
    turnId?: string;
  };

  // Authorize first — never expire unscoped IDs
  let attempt = await loadChatAttempt(attemptId, session.userId, session.organizationId);
  if (!attempt) {
    return new Response("Not found", { status: 404 });
  }

  await expireAttemptIfNeeded({
    attemptId,
    candidateId: session.userId,
    organizationId: session.organizationId,
  });

  attempt = await loadChatAttempt(attemptId, session.userId, session.organizationId);
  if (!attempt) {
    return new Response("Not found", { status: 404 });
  }

  if (!isAttemptAcceptingMessages(attempt.status)) {
    return new Response("Session is no longer active", { status: 400 });
  }

  if (!attempt.organization) {
    return Response.json({ error: "Organization configuration unavailable" }, { status: 500 });
  }

  if (!attempt.scenarioSnapshot) {
    return Response.json({ error: "Attempt snapshot missing" }, { status: 500 });
  }

  const content = getAttemptScenarioContent(attempt);
  const snapshot = getSnapshotFromAttempt(attempt);

  if (action === "complete") {
    try {
      await submitAttempt(attemptId);
      return Response.json({ completed: true });
    } catch (err) {
      if (err instanceof PublicScoringError) {
        return Response.json(
          {
            completed: true,
            scoringComplete: false,
            error: err.publicMessage,
          },
          { status: 200 },
        );
      }
      logSafeError("chat.submit_failed", {
        attemptId,
        category: "scoring_error",
        errorName: safeErrorName(err),
        retryable: true,
      });
      return Response.json(
        { error: CANDIDATE_SCORING_FAILURE_MESSAGE },
        { status: 500 },
      );
    }
  }

  if (action === "evaluate_objective" || action === "evaluate_gate") {
    const objectiveCheckCount = await prisma.attemptEvent.count({
      where: { attemptId, type: "objective_evaluated" },
    });
    if (objectiveCheckCount >= LIMITS.objectiveChecksPerAttempt) {
      return Response.json({ error: "Objective check limit reached" }, { status: 429 });
    }

    await evaluateCurrentObjective(attemptId);
    return Response.json({ evaluated: true });
  }

  if (action === "hint") {
    if (attempt.hintsUsed >= LIMITS.hintRequestsPerAttempt) {
      return Response.json({ error: "Hint limit reached" }, { status: 429 });
    }

    const hintIndex = attempt.hintsUsed;
    const hint = content.hints[hintIndex];
    if (!hint) {
      return Response.json({ error: "No more hints available" }, { status: 400 });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const current = await tx.attempt.findFirst({
          where: { id: attemptId, status: AttemptStatus.IN_PROGRESS, hintsUsed: hintIndex },
        });
        if (!current) {
          throw new Error("HINT_ALREADY_ISSUED");
        }

        const updated = await tx.attempt.update({
          where: { id: attemptId },
          data: {
            hintsUsed: hintIndex + 1,
            hintsPenalty: current.hintsPenalty + hint.penalty,
          },
        });

        const hintTurnId = `hint-${hintIndex + 1}`;
        await tx.attemptMessage.create({
          data: {
            attemptId,
            turnId: hintTurnId,
            role: "assistant",
            content: `**Hint (Level ${hint.level})**\n\n${hint.text}`,
            metadata: { type: "hint", level: hint.level, penalty: hint.penalty },
          },
        });

        await tx.attemptEvent.create({
          data: {
            attemptId,
            type: "hint_requested",
            payload: { level: hint.level, penalty: hint.penalty, hintIndex, turnId: hintTurnId },
          },
        });

        return updated;
      });

      return Response.json({ hint: hint.text, penalty: hint.penalty, hintsUsed: result.hintsUsed });
    } catch (err) {
      if (err instanceof Error && err.message === "HINT_ALREADY_ISSUED") {
        return Response.json({ error: "Hint already issued" }, { status: 409 });
      }
      throw err;
    }
  }

  if (!message?.trim()) {
    return new Response("Message required", { status: 400 });
  }

  if (message.length > LIMITS.candidateMessageMaxLength) {
    return Response.json({ error: "Message too long" }, { status: 400 });
  }

  if (attempt.messageCount >= LIMITS.candidateMessagesPerAttempt) {
    return Response.json({ error: "Message limit reached for this attempt" }, { status: 429 });
  }

  const recentMessages = await prisma.attemptMessage.findMany({
    where: { attemptId, role: "user" },
    orderBy: { createdAt: "desc" },
    take: LIMITS.candidateMessageRatePerMinute,
    select: { createdAt: true },
  });
  if (!checkRateLimit(recentMessages.map((m) => m.createdAt.getTime()), 60_000, LIMITS.candidateMessageRatePerMinute)) {
    return Response.json({ error: "Message rate limit exceeded" }, { status: 429 });
  }

  const turnId =
    typeof clientTurnId === "string" && clientTurnId.length >= 8 && clientTurnId.length <= 80
      ? clientTurnId
      : randomUUID();

  let userMessage;
  try {
    userMessage = await prisma.attemptMessage.create({
      data: { attemptId, turnId, role: "user", content: message.trim() },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existingAssistant = await prisma.attemptMessage.findFirst({
        where: { attemptId, turnId, role: "assistant" },
      });
      if (existingAssistant) {
        return createPolicyViolationStreamResponse(existingAssistant.content);
      }
      const existingUser = await prisma.attemptMessage.findFirst({
        where: { attemptId, turnId, role: "user" },
      });
      if (existingUser) {
        return finishTurnAsProcessingFailure({
          attemptId,
          turnId,
          candidateMessageId: existingUser.id,
          err: new Error("orphan_user_turn"),
          modelLabel: null,
        });
      }
      return Response.json({ error: "Turn already in progress" }, { status: 409 });
    }
    throw err;
  }

  await prisma.attempt.update({
    where: { id: attemptId },
    data: { messageCount: { increment: 1 } },
  });

  let modelLabel: string | null = null;

  try {
    const { model, provider, modelName } = getLanguageModelForAttempt({
      snapshot,
      organization: attempt.organization,
    });
    modelLabel = formatModelLabel(provider, modelName);

    const existingUnsafe = parseUnsafeActionRecords(attempt.unsafeActionRecords);
    const unsafeRecord = await detectUnsafeActionDeterministic(
      content,
      message.trim(),
      existingUnsafe,
      userMessage.id,
      model,
      attemptId,
    );
    if (unsafeRecord) {
      await prisma.attempt.update({
        where: { id: attemptId },
        data: {
          unsafeActionRecords: [...existingUnsafe, unsafeRecord] as object,
          unsafeActions: [
            ...(Array.isArray(attempt.unsafeActions) ? (attempt.unsafeActions as string[]) : []),
            unsafeRecord.description,
          ],
        },
      });
      await prisma.attemptEvent.create({
        data: {
          attemptId,
          type: "unsafe_action",
          payload: { ...unsafeRecord, turnId } as object,
        },
      });
    }

    const classification = await classifyCandidateIntent(model, content, message.trim(), {
      attemptId,
      correlationId: turnId,
    });
    // Optional tagging for scoring analytics — never gates the simulation response.
    const tagging = validateClassifiedAction(content, classification, message.trim());
    const matchedActionId =
      tagging.approvedActionId ??
      classification.matchedActionId ??
      findMatchingAction(content, message.trim());

    let evidenceIds: string[] = [];
    let responseText: string | null = null;
    let responseType = resolveResponseType(classification);
    let dialogueFallback = false;
    let dialogueDeterministic = false;
    let interactionType: string | null = null;
    let stateChanges: Array<{ key: string; value: string }> = [];

    if (classification.decision === "META_OR_PROMPT_ATTACK") {
      responseText = PROMPT_ATTACK_REFUSAL;
      responseType = "prompt_attack_refusal";
    } else if (classification.decision === "DELEGATION_REQUEST") {
      responseText = DELEGATION_REFUSAL;
      responseType = "delegation_refusal";
    } else if (classification.decision === "ANSWER_SEEKING") {
      responseText = ANSWER_SEEKING_REFUSAL;
      responseType = "answer_seeking_refusal";
    } else if (classification.decision === "REFERENCE_QUESTION") {
      responseText = await formatReferenceResponse(model, message.trim(), attemptId);
      responseType = "reference_answer";
    } else {
      const simulationResult = await generateGroundedSimulationResponse({
        model,
        attemptId,
        content,
        candidateMessage: message.trim(),
        transcript: attempt.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        })),
        correlationId: turnId,
      });

      responseText = simulationResult.responseText;
      evidenceIds = simulationResult.disclosedFactIds;
      interactionType = simulationResult.interactionType;
      stateChanges = simulationResult.stateChanges;
      dialogueFallback = simulationResult.usedFallback;
      dialogueDeterministic = false;
      responseType = simulationResult.clarificationNeeded
        ? "clarification"
        : "simulation_response";

      if (evidenceIds.length > 0) {
        const revealed = [
          ...new Set([...parseRevealedEvidenceIds(attempt.revealedEvidenceIds), ...evidenceIds]),
        ];
        await prisma.attempt.update({
          where: { id: attemptId },
          data: { revealedEvidenceIds: revealed },
        });
      }
    }

    if (!responseText) {
      responseText =
        "The simulation could not produce a clear result for that request. Try a more specific interaction.";
    }

    const turnRecord: TurnStructuredRecord = {
      candidateMessageId: userMessage.id,
      classificationDecision: classification.decision,
      targetType: classification.targetType,
      target: classification.target,
      methodOrTool: classification.methodOrTool,
      requestedAction: classification.requestedAction,
      parameters: classification.parameters,
      matchedActionId,
      missingFields: classification.missingFields,
      responseType,
      evidenceIds,
      disclosedFactIds: evidenceIds,
      interactionType,
      stateChanges,
      classifierModel: modelLabel,
      responderModel: modelLabel,
    };

    await prisma.attempt.update({
      where: { id: attemptId },
      data: {
        classifierModel: modelLabel,
        responderModel: modelLabel,
      },
    });

    await prisma.attemptEvent.create({
      data: {
        attemptId,
        type: "turn_classified",
        payload: {
          ...turnRecord,
          turnId,
          dialogueFallback,
          dialogueDeterministic,
          actionTagging: {
            approvedActionId: tagging.approvedActionId,
            validationFailed: tagging.validationFailed,
            validationReason: tagging.validationReason,
          },
        } as object,
      },
    });

    await recordPolicyViolationIfNeeded(attemptId, turnId, userMessage.id, classification.decision);

    const persisted = await persistTurnAssistant(attemptId, turnId, responseText, {
      responseType,
      classificationDecision: classification.decision,
      dialogueFallback,
      dialogueDeterministic,
      turnId,
    });

    return createPolicyViolationStreamResponse(persisted);
  } catch (err) {
    return finishTurnAsProcessingFailure({
      attemptId,
      turnId,
      candidateMessageId: userMessage.id,
      err,
      modelLabel,
    });
  }
}
