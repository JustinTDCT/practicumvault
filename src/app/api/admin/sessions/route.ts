import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTimerState, reconcileExpiredAttempts } from "@/lib/attempts/service";
import { parseScenarioSnapshot } from "@/lib/attempts/snapshot";
import { AttemptStatus, UserRole } from "@prisma/client";

function snapshotMeta(a: {
  scenarioSnapshot: unknown;
  scenarioVersion: { version: string; template: { title: string } };
}) {
  if (a.scenarioSnapshot) {
    try {
      const snap = parseScenarioSnapshot(a.scenarioSnapshot);
      return { title: snap.templateTitle, version: snap.versionDisplay };
    } catch {
      // fall through
    }
  }
  return {
    title: a.scenarioVersion.template.title,
    version: a.scenarioVersion.version,
  };
}

export async function GET() {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await reconcileExpiredAttempts();

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

  return NextResponse.json({
    sessions: attempts.map((a) => {
      const meta = snapshotMeta(a);
      return {
        id: a.id,
        candidateName: a.candidate.fullName,
        candidateEmail: a.candidate.email,
        scenarioTitle: meta.title,
        scenarioVersion: meta.version,
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
      };
    }),
  });
}
