import { streamText } from "ai";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatModelLabel, getLanguageModelForAttempt } from "@/lib/ai/provider";
import { classifyCandidateIntent } from "@/lib/ai/classifier";
import {
  ANSWER_SEEKING_REFUSAL,
  DELEGATION_REFUSAL,
  PROMPT_ATTACK_REFUSAL,
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
  inferEvidenceFormat,
  validateDialogueOutput,
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
import { AttemptStatus, UserRole } from "@prisma/client";
import { Prisma } from "@prisma/client";

type ChatAttempt = Prisma.AttemptGetPayload<{
  include: {
    messages: true;
    scenarioVersion: { include: { template: true } };
    organization: true;
  };
}>;

async function loadChatAttempt(attemptId: string, candidateId: string): Promise<ChatAttempt | null> {
  return prisma.attempt.findFirst({
    where: { id: attemptId, candidateId },
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

async function persistAssistantOnce(
  attemptId: string,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) return;

  const recent = await prisma.attemptMessage.findFirst({
    where: { attemptId, role: "assistant" },
    orderBy: { createdAt: "desc" },
  });
  if (recent && recent.content === trimmed && Date.now() - recent.createdAt.getTime() < 5000) {
    return;
  }

  await prisma.attemptMessage.create({
    data: {
      attemptId,
      role: "assistant",
      content: trimmed,
      metadata: (metadata as object | undefined) ?? undefined,
    },
  });
}

async function recordPolicyViolationIfNeeded(
  attemptId: string,
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
      payload: { path: ["candidateMessageId"], equals: candidateMessageId },
    },
  });
  if (existing) return;

  await prisma.attemptEvent.create({
    data: {
      attemptId,
      type: "policy_violation",
      payload: {
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
  const { message, action } = body as { message?: string; action?: string };

  await expireAttemptIfNeeded(attemptId);

  const attempt = await loadChatAttempt(attemptId, session.userId);
  if (!attempt) {
    return new Response("Not found", { status: 404 });
  }

  if (!isAttemptAcceptingMessages(attempt.status)) {
    return new Response("Session is no longer active", { status: 400 });
  }

  if (!attempt.organization) {
    return Response.json({ error: "Organization configuration unavailable" }, { status: 500 });
  }

  const content = getAttemptScenarioContent(attempt);
  if (!attempt.scenarioSnapshot) {
    return Response.json({ error: "Attempt snapshot missing" }, { status: 500 });
  }
  const snapshot = getSnapshotFromAttempt(attempt);

  if (action === "complete") {
    try {
      await submitAttempt(attemptId);
      return Response.json({ completed: true });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Submission failed" },
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

        await tx.attemptMessage.create({
          data: {
            attemptId,
            role: "assistant",
            content: `**Hint (Level ${hint.level})**\n\n${hint.text}`,
            metadata: { type: "hint", level: hint.level, penalty: hint.penalty },
          },
        });

        await tx.attemptEvent.create({
          data: {
            attemptId,
            type: "hint_requested",
            payload: { level: hint.level, penalty: hint.penalty, hintIndex },
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

  if (attempt.modelCallsCount >= LIMITS.modelCallsPerAttempt) {
    return Response.json({ error: "Model call limit reached for this attempt" }, { status: 429 });
  }

  const recentMessages = await prisma.attemptMessage.findMany({
    where: { attemptId, role: "user" },
    orderBy: { createdAt: "desc" },
    take: LIMITS.candidateMessageRatePerMinute,
    select: { createdAt: true },
  });
  const timestamps = recentMessages.map((m) => m.createdAt.getTime());
  if (!checkRateLimit(timestamps, 60_000, LIMITS.candidateMessageRatePerMinute)) {
    return Response.json({ error: "Message rate limit exceeded" }, { status: 429 });
  }

  const userMessage = await prisma.attemptMessage.create({
    data: { attemptId, role: "user", content: message.trim() },
  });

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
        modelCallsCount: { increment: 1 },
      },
    });
    await prisma.attemptEvent.create({
      data: {
        attemptId,
        type: "unsafe_action",
        payload: unsafeRecord as object,
      },
    });
  }

  const rawClassification = await classifyCandidateIntent(model, content, message.trim());
  const validated = validateClassifiedAction(content, rawClassification, message.trim());
  const classification = validated.classification;
  const responseType = resolveResponseType({ ...classification, decision: validated.decision });

  let evidenceIds: string[] = [];
  let responseText: string | null = null;

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
          modelCallsCount: { increment: 2 },
        },
      });
      await prisma.attemptEvent.create({
        data: { attemptId, type: "turn_classified", payload: turnRecord as object },
      });

      const result = streamText({
        model,
        prompt: `Format an end-user dialogue using ONLY these approved facts. No suggestions. No next steps.

Approved facts:
"""
${selected.evidence}
"""

Candidate request: ${message.trim()}`,
        onFinish: async ({ text: finished }) => {
          const validatedOut = validateDialogueOutput(finished, selected.evidence);
          await persistAssistantOnce(attemptId, validatedOut.text, {
            responseType,
            matchedActionId: matched.id,
          });
        },
      });

      return result.toDataStreamResponse();
    }

    responseText = formatDeterministicEvidence(
      selected.evidence,
      format,
      classification.targetSystem,
    );
  } else if (validated.decision === "REFERENCE_QUESTION") {
    responseText = await formatReferenceResponse(model, message.trim());
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
          candidateMessageId: userMessage.id,
          reason: validated.validationReason,
          classifierDecision: rawClassification.decision,
          matchedActionId: rawClassification.matchedActionId,
        },
      },
    });
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
      modelCallsCount: { increment: 1 },
    },
  });

  await prisma.attemptEvent.create({
    data: {
      attemptId,
      type: "turn_classified",
      payload: turnRecord as object,
    },
  });

  await recordPolicyViolationIfNeeded(attemptId, userMessage.id, validated.decision);

  if (!responseText) {
    responseText = "That action is not available in this environment.";
  }

  await persistAssistantOnce(attemptId, responseText, {
    responseType,
    classificationDecision: validated.decision,
  });

  return createPolicyViolationStreamResponse(responseText);
}
