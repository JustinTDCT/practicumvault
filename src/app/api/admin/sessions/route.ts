import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTimerState, reconcileExpiredAttempts } from "@/lib/attempts/service";
import { AttemptStatus, UserRole } from "@prisma/client";

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
    sessions: attempts.map((a) => ({
      id: a.id,
      candidateName: a.candidate.fullName,
      candidateEmail: a.candidate.email,
      scenarioTitle: a.scenarioVersion.template.title,
      scenarioVersion: a.scenarioVersion.version,
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
    })),
  });
}
