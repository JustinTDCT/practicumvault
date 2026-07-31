import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  abortAttempt,
  expireAttemptIfNeeded,
  getTimerState,
  parseObjectiveStates,
} from "@/lib/attempts/service";
import { parseScenarioSnapshot } from "@/lib/attempts/snapshot";
import { CandidateAttemptDto } from "@/lib/dto/candidate";
import { AttemptStatus, UserRole } from "@prisma/client";

function getSnapshotMeta(attempt: { scenarioSnapshot: unknown; scenarioVersion: { version: string; template: { title: string } } }) {
  if (attempt.scenarioSnapshot) {
    try {
      const snap = parseScenarioSnapshot(attempt.scenarioSnapshot);
      return { title: snap.templateTitle, version: snap.versionDisplay };
    } catch {
      // fall through
    }
  }
  return {
    title: attempt.scenarioVersion.template.title,
    version: attempt.scenarioVersion.version,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: attemptId } = await params;

  await expireAttemptIfNeeded(attemptId);

  const attempt = await prisma.attempt.findFirst({
    where: { id: attemptId, organizationId: session.organizationId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      submittedAt: true,
      expiresAt: true,
      completedAt: true,
      currentGateIndex: true,
      gateStates: true,
      hintsUsed: true,
      hintsPenalty: true,
      overallScore: true,
      scoreBreakdown: true,
      strengths: true,
      developmentAreas: true,
      aiRecommendation: true,
      adminNotes: true,
      scoringComplete: true,
      scoringEngineVersion: true,
      scoringModel: true,
      scoringAttempts: true,
      scenarioSnapshot: true,
      candidateId: true,
      organization: {
        select: {
          showCountdownTimer: true,
          showElapsedTimer: true,
        },
      },
      candidate: {
        select: { fullName: true },
      },
      scenarioVersion: {
        select: {
          version: true,
          template: { select: { title: true } },
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
      },
    },
  });

  if (!attempt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = session.role === UserRole.ADMIN;
  const isOwner = attempt.candidateId === session.userId;
  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const endAt = attempt.submittedAt ?? attempt.completedAt ?? undefined;
  const timer = getTimerState(attempt.startedAt, attempt.expiresAt, endAt ?? undefined);
  const meta = getSnapshotMeta(attempt);

  if (!isAdmin) {
    const response: CandidateAttemptDto = {
      attempt: {
        id: attempt.id,
        status: attempt.status,
        startedAt: attempt.startedAt.toISOString(),
        submittedAt: attempt.submittedAt?.toISOString() ?? null,
        expiresAt: attempt.expiresAt.toISOString(),
        completedAt: attempt.completedAt?.toISOString() ?? null,
        timer,
        scenarioTitle: meta.title,
        scenarioVersion: meta.version,
      },
      messages: attempt.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
      timerSettings: {
        showCountdown: attempt.organization.showCountdownTimer,
        showElapsed: attempt.organization.showElapsedTimer,
      },
    };
    return NextResponse.json(response);
  }

  return NextResponse.json({
    attempt: {
      id: attempt.id,
      status: attempt.status,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      expiresAt: attempt.expiresAt,
      completedAt: attempt.completedAt,
      currentObjectiveIndex: attempt.currentGateIndex,
      objectiveStates: parseObjectiveStates(attempt.gateStates),
      hintsUsed: attempt.hintsUsed,
      hintsPenalty: attempt.hintsPenalty,
      timer,
      scenarioTitle: meta.title,
      scenarioVersion: meta.version,
      candidateName: attempt.candidate.fullName,
      scoringAttempts: attempt.scoringAttempts,
      scoringModel: attempt.scoringModel,
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
    score: {
      overallScore: attempt.overallScore,
      scoreBreakdown: attempt.scoreBreakdown,
      strengths: attempt.strengths,
      developmentAreas: attempt.developmentAreas,
      recommendation: attempt.aiRecommendation,
      adminNotes: attempt.adminNotes,
      scoringComplete: attempt.scoringComplete,
      scoringEngineVersion: attempt.scoringEngineVersion,
      scoringModel: attempt.scoringModel,
      scoringAttempts: attempt.scoringAttempts,
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: attemptId } = await params;
  const attempt = await prisma.attempt.findFirst({
    where: { id: attemptId, organizationId: session.organizationId },
    select: { id: true, status: true, candidateId: true },
  });
  if (!attempt) {
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
