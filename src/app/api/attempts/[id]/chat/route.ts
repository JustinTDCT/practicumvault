import { streamText } from "ai";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLanguageModel } from "@/lib/ai/provider";
import { buildInterviewSystemPrompt } from "@/lib/ai/prompts";
import {
  createPolicyViolationStreamResponse,
  detectCheatAttempt,
  POLICY_VIOLATION_REFUSAL,
} from "@/lib/ai/cheat-detection";
import {
  expireAttemptIfNeeded,
  parseObjectiveStates,
  parseTemplateContent,
} from "@/lib/attempts/service";
import { detectUnsafeAction, evaluateCurrentObjective, finalizeAttemptScoring } from "@/lib/scoring/engine";
import { AttemptStatus, UserRole } from "@prisma/client";

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
      scenarioVersion: true,
      organization: true,
    },
  });

  if (!attempt || attempt.candidateId !== session.userId) {
    return new Response("Not found", { status: 404 });
  }

  const expired = await expireAttemptIfNeeded(attemptId);
  if (expired?.status !== AttemptStatus.IN_PROGRESS) {
    return new Response("Session is no longer active", { status: 400 });
  }

  const content = parseTemplateContent(attempt.scenarioVersion.content);

  if (action === "complete") {
    await finalizeAttemptScoring(attemptId);
    return Response.json({ completed: true });
  }

  if (action === "evaluate_objective" || action === "evaluate_gate") {
    const objectiveStates = await evaluateCurrentObjective(attemptId);
    const allPassed = content.objectives.every((o) =>
      objectiveStates.find((s) => s.objectiveId === o.id)?.passed,
    );
    return Response.json({ objectiveStates, gateStates: objectiveStates, allPassed, allCompleted: allPassed });
  }

  if (action === "hint") {
    const hintIndex = attempt.hintsUsed;
    const hint = content.hints[hintIndex];
    if (!hint) {
      return Response.json({ error: "No more hints available" }, { status: 400 });
    }
    await prisma.attempt.update({
      where: { id: attemptId },
      data: {
        hintsUsed: hintIndex + 1,
        hintsPenalty: attempt.hintsPenalty + hint.penalty,
      },
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
    return Response.json({ hint: hint.text, penalty: hint.penalty });
  }

  if (!message?.trim()) {
    return new Response("Message required", { status: 400 });
  }

  await prisma.attemptMessage.create({
    data: { attemptId, role: "user", content: message.trim() },
  });

  const cheatCheck = detectCheatAttempt(message.trim());
  if (cheatCheck.blocked) {
    const refusal = cheatCheck.refusalMessage ?? POLICY_VIOLATION_REFUSAL;
    await prisma.attemptMessage.create({
      data: {
        attemptId,
        role: "assistant",
        content: refusal,
        metadata: {
          type: "policy_violation",
          reason: cheatCheck.reason,
          category: cheatCheck.category,
        },
      },
    });
    await prisma.attemptEvent.create({
      data: {
        attemptId,
        type: "policy_violation",
        payload: {
          message: message.trim(),
          reason: cheatCheck.reason,
          category: cheatCheck.category,
        },
      },
    });
    return createPolicyViolationStreamResponse(refusal);
  }

  await detectUnsafeAction(attemptId, message.trim());

  const objectiveStates = parseObjectiveStates(attempt.gateStates);
  const systemPrompt = buildInterviewSystemPrompt(
    content,
    attempt.currentGateIndex,
    objectiveStates,
  );

  const history = attempt.messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  history.push({ role: "user", content: message.trim() });

  const model = getLanguageModel(attempt.organization);

  const result = streamText({
    model,
    system: systemPrompt,
    messages: history,
    onFinish: async ({ text }) => {
      await prisma.attemptMessage.create({
        data: {
          attemptId,
          role: "assistant",
          content: text,
        },
      });
      await prisma.attemptEvent.create({
        data: {
          attemptId,
          type: "message",
          payload: { role: "assistant", length: text.length },
        },
      });
    },
  });

  return result.toDataStreamResponse();
}
