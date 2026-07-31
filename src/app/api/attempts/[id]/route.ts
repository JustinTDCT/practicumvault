import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  abortAttempt,
  expireAttemptIfNeeded,
  getTimerState,
  parseObjectiveStates,
} from "@/lib/attempts/service";
import { AttemptStatus, UserRole } from "@prisma/client";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: attemptId } = await params;

  let attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      scenarioVersion: { include: { template: true } },
      organization: true,
      candidate: true,
    },
  });

  if (!attempt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (attempt.organizationId !== session.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isAdmin = session.role === UserRole.ADMIN;
  const isOwner = attempt.candidateId === session.userId;
  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await expireAttemptIfNeeded(attemptId);
  attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      scenarioVersion: { include: { template: true } },
      organization: true,
      candidate: true,
    },
  });
  if (!attempt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const endAt = attempt.submittedAt ?? attempt.completedAt ?? undefined;
  const timer = getTimerState(attempt.startedAt, attempt.expiresAt, endAt ?? undefined);

  const response: Record<string, unknown> = {
    attempt: {
      id: attempt.id,
      status: attempt.status,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      expiresAt: attempt.expiresAt,
      completedAt: attempt.completedAt,
      currentObjectiveIndex: attempt.currentGateIndex,
      objectiveStates: parseObjectiveStates(attempt.gateStates),
      /** @deprecated */ currentGateIndex: attempt.currentGateIndex,
      /** @deprecated */ gateStates: parseObjectiveStates(attempt.gateStates),
      hintsUsed: attempt.hintsUsed,
      timer,
      scenarioTitle: attempt.scenarioVersion.template.title,
      scenarioVersion: attempt.scenarioVersion.version,
      candidateName: isAdmin ? attempt.candidate.fullName : undefined,
    },
    messages: attempt.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
    timerSettings: {
      showCountdown: attempt.organization.showCountdownTimer,
      showElapsed: attempt.organization.showElapsedTimer,
    },
  };

  if (isAdmin) {
    response.score = {
      overallScore: attempt.overallScore,
      scoreBreakdown: attempt.scoreBreakdown,
      strengths: attempt.strengths,
      developmentAreas: attempt.developmentAreas,
      recommendation: attempt.aiRecommendation,
      adminNotes: attempt.adminNotes,
      scoringComplete: attempt.scoringComplete,
      scoringEngineVersion: attempt.scoringEngineVersion,
    };
  }

  return NextResponse.json(response);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: attemptId } = await params;
  const attempt = await prisma.attempt.findUnique({ where: { id: attemptId } });
  if (!attempt || attempt.organizationId !== session.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isAdmin = session.role === UserRole.ADMIN;
  const isOwner = attempt.candidateId === session.userId;
  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (attempt.status !== AttemptStatus.IN_PROGRESS) {
    return NextResponse.json({ error: "Attempt is not in progress" }, { status: 400 });
  }

  await abortAttempt(attemptId, isAdmin ? "admin" : "candidate");
  return NextResponse.json({ success: true });
}
