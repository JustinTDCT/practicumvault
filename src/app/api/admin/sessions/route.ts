import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTimerState, reconcileExpiredAttempts } from "@/lib/attempts/service";
import { SnapshotIntegrityError, requireAttemptSnapshot } from "@/lib/attempts/snapshot";
import { AttemptStatus, UserRole } from "@prisma/client";

export async function GET() {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await reconcileExpiredAttempts(session.organizationId);

  const attempts = await prisma.attempt.findMany({
    where: {
      organizationId: session.organizationId,
      status: AttemptStatus.IN_PROGRESS,
    },
    include: {
      candidate: true,
      scenarioVersion: { include: { template: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { startedAt: "asc" },
  });

  const sessions = [];
  for (const a of attempts) {
    try {
      const snap = requireAttemptSnapshot(a);
      if (!snap.templateSlug) {
        throw new SnapshotIntegrityError(
          "Historical scenario snapshot is missing templateSlug. Run snapshot backfill.",
        );
      }
      sessions.push({
        id: a.id,
        candidateName: a.candidate.fullName,
        candidateEmail: a.candidate.email,
        scenarioTitle: snap.templateTitle,
        scenarioVersion: snap.versionDisplay,
        scenarioSlug: snap.templateSlug,
        snapshotIntegrityError: null as string | null,
        startedAt: a.startedAt,
        expiresAt: a.expiresAt,
        timer: getTimerState(a.startedAt, a.expiresAt),
        messageCount: a.messages.length,
        messages: a.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        })),
      });
    } catch (err) {
      const message =
        err instanceof SnapshotIntegrityError
          ? err.message
          : "Historical scenario snapshot is missing or invalid. Run snapshot backfill.";
      sessions.push({
        id: a.id,
        candidateName: a.candidate.fullName,
        candidateEmail: a.candidate.email,
        scenarioTitle: null,
        scenarioVersion: null,
        scenarioSlug: null,
        snapshotIntegrityError: message,
        startedAt: a.startedAt,
        expiresAt: a.expiresAt,
        timer: getTimerState(a.startedAt, a.expiresAt),
        messageCount: a.messages.length,
        messages: a.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        })),
      });
    }
  }

  return NextResponse.json({ sessions });
}
