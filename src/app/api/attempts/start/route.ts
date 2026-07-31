import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  computeExpiresAt,
  getActiveAttemptForCandidate,
  assignmentStartBlockedReason,
  parseTemplateContent,
} from "@/lib/attempts/service";
import { AttemptStatus, AssignmentStatus, UserRole } from "@prisma/client";

export async function POST(request: NextRequest) {
  const session = await requireAuth([UserRole.CANDIDATE]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { assignmentId } = body;

  const active = await getActiveAttemptForCandidate(session.userId);
  if (active) {
    return NextResponse.json(
      { error: "You already have an active session. Complete or abort it first." },
      { status: 400 },
    );
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { scenarioVersion: { include: { template: true } } },
  });

  if (!assignment || assignment.candidateId !== session.userId) {
    return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  }

  const blockedReason = assignmentStartBlockedReason(assignment.status);
  if (blockedReason) {
    return NextResponse.json({ error: blockedReason }, { status: 400 });
  }

  const startedAt = new Date();
  const expiresAt = computeExpiresAt(startedAt, assignment.scenarioVersion.timeLimitMinutes);
  const content = parseTemplateContent(assignment.scenarioVersion.content);
  const initialObjectiveStates = content.objectives.map((o) => ({
    objectiveId: o.id,
    passed: false,
    attempts: 0,
  }));

  const openingMessage = `**Assessment started**

**Ticket — ${content.startingSituation.ticketSubject}**
User: ${content.startingSituation.ticketUser}
Priority: ${content.startingSituation.ticketPriority}

> ${content.startingSituation.ticketBody}

${content.startingSituation.candidateInstructions}`;

  const attempt = await prisma.attempt.create({
    data: {
      assignmentId: assignment.id,
      candidateId: session.userId,
      scenarioVersionId: assignment.scenarioVersionId,
      organizationId: session.organizationId,
      expiresAt,
      gateStates: initialObjectiveStates,
      status: AttemptStatus.IN_PROGRESS,
      messages: {
        create: { role: "assistant", content: openingMessage },
      },
      events: {
        create: { type: "started", payload: { assignmentId: assignment.id } },
      },
    },
    include: {
      scenarioVersion: { include: { template: true } },
      messages: true,
    },
  });

  await prisma.assignment.update({
    where: { id: assignment.id },
    data: { status: AssignmentStatus.IN_PROGRESS },
  });

  return NextResponse.json({ attempt });
}
