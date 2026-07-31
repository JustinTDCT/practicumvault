import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getActiveAttemptForCandidate, canCandidateStartAssignment } from "@/lib/attempts/service";
import { UserRole } from "@prisma/client";

export async function GET() {
  const session = await requireAuth([UserRole.CANDIDATE]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [assignments, activeAttempt] = await Promise.all([
    prisma.assignment.findMany({
      where: { candidateId: session.userId },
      include: {
        scenarioVersion: { include: { template: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    getActiveAttemptForCandidate(session.userId),
  ]);

  return NextResponse.json({
    assignments: assignments.map((a) => ({
      ...a,
      canStart: canCandidateStartAssignment(a.status),
    })),
    activeAttempt: activeAttempt ? { id: activeAttempt.id } : null,
  });
}
