import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: attemptId } = await params;
  const attempt = await prisma.attempt.findFirst({
    where: { id: attemptId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!attempt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const runs = await prisma.attemptEvent.findMany({
    where: {
      attemptId,
      type: { in: ["scored", "scoring_failed"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      createdAt: true,
      payload: true,
    },
  });

  return NextResponse.json({
    runs: runs.map((run) => ({
      id: run.id,
      type: run.type,
      createdAt: run.createdAt.toISOString(),
      payload: sanitizeScoringPayload(run.payload),
    })),
  });
}

function sanitizeScoringPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  return {
    overallScore: p.overallScore ?? null,
    scoringModel: p.scoringModel ?? p.model ?? null,
    modelMode: p.modelMode ?? null,
    category: p.category ?? null,
    retryable: p.retryable ?? null,
    scoringAttempt: p.scoringAttempt ?? null,
    rescore: p.rescore ?? null,
    runId: p.runId ?? null,
    detail: typeof p.detail === "string" ? p.detail : null,
  };
}
