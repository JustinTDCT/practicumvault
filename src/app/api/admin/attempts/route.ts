import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rescoreAttempt } from "@/lib/scoring/engine";
import { SnapshotIntegrityError, requireAttemptSnapshot } from "@/lib/attempts/snapshot";
import { RescoreModelMode } from "@/lib/ai/provider";
import { UserRole } from "@prisma/client";

function titleFromAttempt(a: { scenarioSnapshot: unknown }) {
  const snap = requireAttemptSnapshot(a);
  if (!snap.templateSlug) {
    throw new SnapshotIntegrityError(
      "Historical scenario snapshot is missing templateSlug. Run snapshot backfill.",
    );
  }
  return {
    title: snap.templateTitle,
    version: snap.versionDisplay,
    slug: snap.templateSlug,
  };
}

export async function GET() {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const attempts = await prisma.attempt.findMany({
    where: {
      organizationId: session.organizationId,
      status: { not: "IN_PROGRESS" },
    },
    include: {
      candidate: true,
      scenarioVersion: { include: { template: true } },
      assignment: { include: { position: true } },
    },
    orderBy: { startedAt: "desc" },
  });

  return NextResponse.json({
    attempts: attempts.map((a) => {
      try {
        const meta = titleFromAttempt(a);
        return {
          id: a.id,
          candidateName: a.candidate.fullName,
          scenarioTitle: meta.title,
          scenarioSlug: meta.slug,
          version: meta.version,
          status: a.status,
          overallScore: a.overallScore,
          startedAt: a.startedAt,
          completedAt: a.completedAt,
          submittedAt: a.submittedAt,
          scoringAttempts: a.scoringAttempts,
          snapshotIntegrityError: null as string | null,
        };
      } catch (err) {
        return {
          id: a.id,
          candidateName: a.candidate.fullName,
          scenarioTitle: "(snapshot integrity error)",
          scenarioSlug: null,
          version: null,
          status: a.status,
          overallScore: a.overallScore,
          startedAt: a.startedAt,
          completedAt: a.completedAt,
          submittedAt: a.submittedAt,
          scoringAttempts: a.scoringAttempts,
          snapshotIntegrityError:
            err instanceof SnapshotIntegrityError
              ? err.message
              : "Historical scenario snapshot is missing or invalid. Run snapshot backfill.",
        };
      }
    }),
  });
}

export async function PATCH(request: NextRequest) {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { attemptId, adminNotes, action, modelMode } = body;

  if (!attemptId) {
    return NextResponse.json({ error: "Attempt ID required" }, { status: 400 });
  }

  if (action === "rescore") {
    try {
      const mode: RescoreModelMode =
        modelMode === "CURRENT_MODEL" ? "CURRENT_MODEL" : "ORIGINAL_MODEL";
      const attempt = await rescoreAttempt(attemptId, session.organizationId, mode);
      return NextResponse.json({
        attempt: {
          id: attempt?.id,
          status: attempt?.status,
          overallScore: attempt?.overallScore,
          scoringModel: attempt?.scoringModel,
        },
      });
    } catch (err) {
      const { publicScoringErrorBody } = await import("@/lib/scoring/public-error");
      console.error("[admin] rescore failed", attemptId, err);
      return NextResponse.json(publicScoringErrorBody(err), { status: 400 });
    }
  }

  const attempt = await prisma.attempt.update({
    where: { id: attemptId, organizationId: session.organizationId },
    data: { adminNotes: adminNotes ?? "" },
  });

  return NextResponse.json({ attempt: { id: attempt.id, adminNotes: attempt.adminNotes } });
}
