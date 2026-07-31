import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getActiveAttemptForCandidate, canCandidateStartAssignment } from "@/lib/attempts/service";
import { CandidateDashboardDto } from "@/lib/dto/candidate";
import { UserRole } from "@prisma/client";

export async function GET() {
  const session = await requireAuth([UserRole.CANDIDATE]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [assignments, activeAttempt] = await Promise.all([
    prisma.assignment.findMany({
      where: { candidateId: session.userId },
      select: {
        id: true,
        status: true,
        scenarioVersion: {
          select: {
            version: true,
            timeLimitMinutes: true,
            template: {
              select: { title: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    getActiveAttemptForCandidate(session.userId),
  ]);

  const response: CandidateDashboardDto = {
    assignments: assignments.map((a) => ({
      id: a.id,
      status: a.status,
      canStart: canCandidateStartAssignment(a.status),
      scenario: {
        title: a.scenarioVersion.template.title,
        displayedVersion: a.scenarioVersion.version,
        timeLimitMinutes: a.scenarioVersion.timeLimitMinutes,
      },
    })),
    activeAttempt: activeAttempt ? { id: activeAttempt.id } : null,
  };

  return NextResponse.json(response);
}
