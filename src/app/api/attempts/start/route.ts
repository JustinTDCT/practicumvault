import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  computeExpiresAt,
  assignmentStartBlockedReason,
  parseTemplateContent,
} from "@/lib/attempts/service";
import { buildScenarioSnapshot } from "@/lib/attempts/snapshot";
import { AttemptStatus, AssignmentStatus, UserRole } from "@prisma/client";

export async function POST(request: NextRequest) {
  const session = await requireAuth([UserRole.CANDIDATE]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { assignmentId } = body;

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      scenarioVersion: { include: { template: true } },
    },
  });

  if (!assignment || assignment.candidateId !== session.userId) {
    return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  }

  const blockedReason = assignmentStartBlockedReason(assignment.status);
  if (blockedReason) {
    return NextResponse.json({ error: blockedReason }, { status: 400 });
  }

  const org = await prisma.organization.findUnique({ where: { id: session.organizationId } });
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 500 });

  const startedAt = new Date();
  const expiresAt = computeExpiresAt(startedAt, assignment.scenarioVersion.timeLimitMinutes);
  const content = parseTemplateContent(assignment.scenarioVersion.content);
  const snapshot = buildScenarioSnapshot(
    assignment.scenarioVersion.template,
    assignment.scenarioVersion,
    org,
  );
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

  const attempt = await prisma.$transaction(async (tx) => {
    const active = await tx.attempt.findFirst({
      where: { candidateId: session.userId, status: AttemptStatus.IN_PROGRESS },
    });
    if (active) {
      throw new Error("ACTIVE_ATTEMPT_EXISTS");
    }

    const inProgressAssignment = await tx.assignment.findFirst({
      where: { candidateId: session.userId, status: AssignmentStatus.IN_PROGRESS, id: { not: assignment.id } },
    });
    if (inProgressAssignment) {
      throw new Error("OTHER_ASSIGNMENT_IN_PROGRESS");
    }

    return tx.attempt.create({
      data: {
        assignmentId: assignment.id,
        candidateId: session.userId,
        scenarioVersionId: assignment.scenarioVersionId,
        organizationId: session.organizationId,
        expiresAt,
        gateStates: initialObjectiveStates,
        scenarioSnapshot: snapshot as object,
        status: AttemptStatus.IN_PROGRESS,
        messages: {
          create: { role: "assistant", content: openingMessage },
        },
        events: {
          create: {
            type: "started",
            payload: { assignmentId: assignment.id, snapshotVersion: snapshot.simulationPromptVersion },
          },
        },
      },
      include: {
        scenarioVersion: { include: { template: true } },
        messages: true,
      },
    });
  }).catch((err) => {
    if (err instanceof Error && err.message === "ACTIVE_ATTEMPT_EXISTS") {
      return null;
    }
    throw err;
  });

  if (!attempt) {
    return NextResponse.json(
      { error: "You already have an active session. Complete or abort it first." },
      { status: 400 },
    );
  }

  await prisma.assignment.update({
    where: { id: assignment.id, status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ABORTED, AssignmentStatus.TIMED_OUT] } },
    data: { status: AssignmentStatus.IN_PROGRESS },
  });

  return NextResponse.json({ attempt });
}
