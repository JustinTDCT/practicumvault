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
} from "@/lib/ai/classifier";
import {
  buildStaticResponse,
  formatReferenceResponse,
  resolveResponseType,
  selectEvidenceForAction,
} from "@/lib/ai/simulation";
import { validateClassifiedAction } from "@/lib/ai/validate-action";
import {
  formatDeterministicEvidence,
  formatDeterministicDialogue,
  inferEvidenceFormat,
} from "@/lib/ai/format-evidence";
import { TurnStructuredRecord } from "@/lib/ai/types";
import { createPolicyViolationStreamResponse } from "@/lib/ai/cheat-detection";
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
import { LIMITS, POLICY_VIOLATION_PENALTY } from "@/lib/config/limits";
import { AttemptStatus, UserRole, Prisma } from "@prisma/client";

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

async function persistTurnAssistant(
  attemptId: string,
  turnId: string,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) return;

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
  } catch (err) {
    // Unique (attemptId, turnId, role) — idempotent retry
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return;
    }
    throw err;
  }
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
      const { PublicScoringError, CANDIDATE_SCORING_FAILURE_MESSAGE } = await import(
        "@/lib/scoring/public-error"
      );
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
      console.error("[chat] submit failed", attemptId, err);
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
      return Response.json({ error: "Turn already in progress" }, { status: 409 });
    }
    throw err;
  }

  await prisma.attempt.update({
    where: { id: attemptId },
    data: { messageCount: { increment: 1 } },
  });

  const { model, provider, modelName } = getLanguageModelForAttempt({
    snapshot,
    organization: attempt.organization,
  });
  const modelLabel = formatModelLabel(provider, modelName);

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

  const rawClassification = await classifyCandidateIntent(model, content, message.trim(), {
    attemptId,
  });
  const validated = validateClassifiedAction(content, rawClassification, message.trim());
  const classification = validated.classification;
  const responseType = resolveResponseType({ ...classification, decision: validated.decision });

  let evidenceIds: string[] = [];
  let responseText: string | null = null;
  let dialogueFallback = false;
  let dialogueDeterministic = false;

  if (validated.decision === "VALID_ACTION" && validated.approvedActionId) {
    const matched = content.actions.find((a) => a.id === validated.approvedActionId)!;
    const selected = selectEvidenceForAction(content, matched.id);
    evidenceIds = selected.evidenceIds;

    const revealed = [
      ...new Set([...parseRevealedEvidenceIds(attempt.revealedEvidenceIds), ...evidenceIds]),
    ];
    await prisma.attempt.update({
      where: { id: attemptId },
      data: { revealedEvidenceIds: revealed },
    });

    const format = inferEvidenceFormat(matched.category, matched.label);
    if (format === "dialogue") {
      const dialogue = formatDeterministicDialogue(selected.evidence);
      responseText = dialogue.text;
      dialogueFallback = dialogue.usedFallback;
      dialogueDeterministic = dialogue.deterministic;
    } else {
      responseText = formatDeterministicEvidence(
        selected.evidence,
        format,
        classification.targetSystem,
      );
    }
  } else if (validated.decision === "REFERENCE_QUESTION") {
    responseText = await formatReferenceResponse(model, message.trim(), attemptId);
  } else if (validated.clarification) {
    responseText = validated.clarification;
  } else if (validated.decision === "DELEGATION_REQUEST") {
    responseText = DELEGATION_REFUSAL;
  } else if (validated.decision === "ANSWER_SEEKING") {
    responseText = ANSWER_SEEKING_REFUSAL;
  } else if (validated.decision === "META_OR_PROMPT_ATTACK") {
    responseText = PROMPT_ATTACK_REFUSAL;
  } else {
    responseText = buildStaticResponse({ ...classification, decision: validated.decision });
  }

  if (validated.validationFailed) {
    await prisma.attemptEvent.create({
      data: {
        attemptId,
        type: "action_validation_failed",
        payload: {
          turnId,
          candidateMessageId: userMessage.id,
          reason: validated.validationReason,
          classifierDecision: rawClassification.decision,
          matchedActionId: rawClassification.matchedActionId,
        },
      },
    });
  }

  if (!responseText) {
    responseText = "That action is not available in this environment.";
  }

  const turnRecord: TurnStructuredRecord = {
    candidateMessageId: userMessage.id,
    classificationDecision: validated.decision,
    targetSystem: classification.targetSystem,
    methodOrTool: classification.methodOrTool,
    requestedAction: classification.requestedAction,
    parameters: classification.parameters,
    matchedActionId: validated.approvedActionId,
    missingFields: classification.missingFields,
    responseType,
    evidenceIds,
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
      payload: { ...turnRecord, turnId, dialogueFallback, dialogueDeterministic } as object,
    },
  });

  await recordPolicyViolationIfNeeded(attemptId, turnId, userMessage.id, validated.decision);

  await persistTurnAssistant(attemptId, turnId, responseText, {
    responseType,
    classificationDecision: validated.decision,
    dialogueFallback,
    dialogueDeterministic,
    turnId,
  });

  // Return exactly the persisted validated text — never stream unvalidated dialogue
  return createPolicyViolationStreamResponse(responseText);
}
