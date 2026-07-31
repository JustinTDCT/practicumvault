import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLanguageModel, providerLabel } from "@/lib/ai/provider";
import {
  classifyCandidateIntent,
} from "@/lib/ai/classifier";
import {
  buildStaticResponse,
  formatReferenceResponse,
  lookupScenarioAction,
  resolveResponseType,
  selectEvidenceForAction,
  streamFormattedResponse,
} from "@/lib/ai/simulation";
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
import { LIMITS } from "@/lib/config/limits";
import { UserRole } from "@prisma/client";

function checkRateLimit(
  timestamps: number[],
  windowMs: number,
  max: number,
): boolean {
  const now = Date.now();
  const recent = timestamps.filter((t) => now - t < windowMs);
  return recent.length < max;
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

  let attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      scenarioVersion: { include: { template: true } },
      organization: true,
    },
  });

  if (!attempt || attempt.candidateId !== session.userId) {
    return new Response("Not found", { status: 404 });
  }

  const expired = await expireAttemptIfNeeded(attemptId);
  if (!expired || !isAttemptAcceptingMessages(expired.status)) {
    return new Response("Session is no longer active", { status: 400 });
  }

  attempt = expired as typeof attempt;
  const content = getAttemptScenarioContent(attempt);
  const snapshot = attempt.scenarioSnapshot
    ? getSnapshotFromAttempt(attempt)
    : null;

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

    const objectiveStates = await evaluateCurrentObjective(attemptId);
    const allPassed = content.objectives.every((o) =>
      objectiveStates.find((s) => s.objectiveId === o.id)?.passed,
    );
    return Response.json({ objectiveStates, gateStates: objectiveStates, allPassed, allCompleted: allPassed });
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

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.attempt.findUnique({ where: { id: attemptId } });
      if (!current || current.hintsUsed !== hintIndex) {
        throw new Error("Hint already issued");
      }
      return tx.attempt.update({
        where: { id: attemptId, hintsUsed: hintIndex },
        data: {
          hintsUsed: hintIndex + 1,
          hintsPenalty: current.hintsPenalty + hint.penalty,
        },
      });
    });

    await prisma.attemptMessage.create({
      data: {
        attemptId,
        role: "assistant",
        content: `**Hint (Level ${hint.level})**\n\n${hint.text}`,
        metadata: { type: "hint", level: hint.level, penalty: hint.penalty },
      },
    });
    await prisma.attemptEvent.create({
      data: {
        attemptId,
        type: "hint_requested",
        payload: { level: hint.level, penalty: hint.penalty },
      },
    });
    return Response.json({ hint: hint.text, penalty: hint.penalty, hintsUsed: updated.hintsUsed });
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

  const model = getLanguageModel(attempt.organization);
  const modelLabel = snapshot
    ? `${providerLabel(snapshot.modelProvider)}/${snapshot.modelName}`
    : providerLabel(attempt.organization.llmProvider);

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
        unsafeActions: [...(Array.isArray(attempt.unsafeActions) ? attempt.unsafeActions as string[] : []), unsafeRecord.description],
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

  const classification = await classifyCandidateIntent(model, content, message.trim());
  const responseType = resolveResponseType(classification);
  let evidenceIds: string[] = [];
  let responseText: string | null = null;
  let streamResponse: Response | null = null;

  if (classification.decision === "VALID_ACTION") {
    const actionId = classification.matchedActionId;
    const matched = actionId ? lookupScenarioAction(content, actionId) : null;

    if (matched) {
      const selected = selectEvidenceForAction(content, matched.id);
      evidenceIds = selected.evidenceIds;
      const revealed = [...new Set([...parseRevealedEvidenceIds(attempt.revealedEvidenceIds), ...evidenceIds])];
      await prisma.attempt.update({
        where: { id: attemptId },
        data: { revealedEvidenceIds: revealed },
      });
      streamResponse = streamFormattedResponse(
        model,
        selected.evidence,
        classification.targetSystem,
        matched.label,
      );
    } else {
      responseText = "That action is not available in this environment.";
    }
  } else if (classification.decision === "REFERENCE_QUESTION") {
    responseText = await formatReferenceResponse(model, message.trim());
  } else {
    responseText = buildStaticResponse(classification);
  }

  const turnRecord: TurnStructuredRecord = {
    candidateMessageId: userMessage.id,
    classificationDecision: classification.decision,
    targetSystem: classification.targetSystem,
    methodOrTool: classification.methodOrTool,
    requestedAction: classification.requestedAction,
    parameters: classification.parameters,
    matchedActionId: classification.matchedActionId,
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
      modelCallsCount: { increment: classification.decision === "VALID_ACTION" ? 2 : 1 },
    },
  });

  await prisma.attemptEvent.create({
    data: {
      attemptId,
      type: "turn_classified",
      payload: turnRecord as object,
    },
  });

  if (streamResponse) {
    const originalBody = streamResponse.body;
    if (!originalBody) return streamResponse;

    const reader = originalBody.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split("\n")) {
              if (line.startsWith("0:")) {
                try {
                  fullText += JSON.parse(line.slice(2));
                } catch {
                  // partial chunk handled by client
                }
              }
            }
          }
          if (fullText.trim()) {
            await prisma.attemptMessage.create({
              data: { attemptId, role: "assistant", content: fullText.trim() },
            });
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: streamResponse.headers,
    });
  }

  if (responseText) {
    await prisma.attemptMessage.create({
      data: {
        attemptId,
        role: "assistant",
        content: responseText,
        metadata: { responseType, classificationDecision: classification.decision },
      },
    });
    return createPolicyViolationStreamResponse(responseText);
  }

  return new Response("Unable to process request", { status: 500 });
}
