import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  abortAttempt,
  expireAttemptIfNeeded,
  getTimerState,
  parseObjectiveStates,
} from "@/lib/attempts/service";
import { SnapshotIntegrityError, requireAttemptSnapshot } from "@/lib/attempts/snapshot";
import { CandidateAttemptDto } from "@/lib/dto/candidate";
import { AttemptStatus, UserRole } from "@prisma/client";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: attemptId } = await params;
  const isAdmin = session.role === UserRole.ADMIN;

  const authorized = await prisma.attempt.findFirst({
    where: {
      id: attemptId,
      organizationId: session.organizationId,
      ...(isAdmin ? {} : { candidateId: session.userId }),
    },
    select: { id: true, candidateId: true },
  });
  if (!authorized) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await expireAttemptIfNeeded({
    attemptId,
    organizationId: session.organizationId,
    ...(isAdmin ? {} : { candidateId: session.userId }),
  });

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
      lastScoringFailure: true,
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
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
          turnId: true,
        },
      },
    },
  });

  if (!attempt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let meta: { title: string; version: string; slug: string };
  try {
    const snap = requireAttemptSnapshot(attempt);
    meta = { title: snap.templateTitle, version: snap.versionDisplay, slug: snap.templateSlug };
  } catch (err) {
    if (isAdmin) {
      return NextResponse.json(
        {
          error:
            err instanceof SnapshotIntegrityError
              ? err.message
              : "Historical scenario snapshot is missing or invalid. Run snapshot backfill.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const endAt = attempt.submittedAt ?? attempt.completedAt ?? undefined;
  const timer = getTimerState(attempt.startedAt, attempt.expiresAt, endAt ?? undefined);

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

  const failure = attempt.lastScoringFailure as {
    at?: string;
    category?: string;
    retryable?: boolean;
    model?: string;
    scoringAttempt?: number;
  } | null;

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
      scenarioSlug: meta.slug,
      candidateName: attempt.candidate.fullName,
      scoringAttempts: attempt.scoringAttempts,
      scoringModel: attempt.scoringModel,
      lastScoringFailure: failure
        ? {
            at: failure.at ?? null,
            category: failure.category ?? "scoring_error",
            retryable: failure.retryable ?? true,
            model: failure.model ?? attempt.scoringModel ?? null,
            scoringAttempt: failure.scoringAttempt ?? attempt.scoringAttempts,
          }
        : null,
    },
    messages: attempt.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      turnId: m.turnId,
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
  const isAdmin = session.role === UserRole.ADMIN;

  const attempt = await prisma.attempt.findFirst({
    where: {
      id: attemptId,
      organizationId: session.organizationId,
      ...(isAdmin ? {} : { candidateId: session.userId }),
    },
    select: { id: true, status: true, candidateId: true },
  });
  if (!attempt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (attempt.status !== AttemptStatus.IN_PROGRESS) {
    return NextResponse.json({ error: "Attempt is not in progress" }, { status: 400 });
  }

  await abortAttempt(attemptId, isAdmin ? "admin" : "candidate", {
    organizationId: session.organizationId,
    ...(isAdmin ? {} : { candidateId: session.userId }),
  });
  return NextResponse.json({ success: true });
}
