import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  computeExpiresAt,
  assignmentStartBlockedReason,
  parseTemplateContent,
  reconcileExpiredAttemptsForCandidate,
} from "@/lib/attempts/service";
import { buildScenarioSnapshot } from "@/lib/attempts/snapshot";
import { CandidateStartAttemptDto } from "@/lib/dto/candidate";
import { AttemptStatus, AssignmentStatus, UserRole } from "@prisma/client";

export async function POST(request: NextRequest) {
  const session = await requireAuth([UserRole.CANDIDATE]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { assignmentId } = body as { assignmentId?: string };
  if (!assignmentId || typeof assignmentId !== "string") {
    return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  }

  await reconcileExpiredAttemptsForCandidate(session.userId);

  const assignment = await prisma.assignment.findFirst({
    where: {
      id: assignmentId,
      candidateId: session.userId,
      organizationId: session.organizationId,
    },
    select: {
      id: true,
      status: true,
      scenarioVersionId: true,
      scenarioVersion: {
        select: {
          id: true,
          version: true,
          timeLimitMinutes: true,
          content: true,
          templateId: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          publishedAt: true,
          template: {
            select: {
              id: true,
              slug: true,
              title: true,
              description: true,
              enabled: true,
              organizationId: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  });

  if (!assignment) {
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
    {
      ...assignment.scenarioVersion,
      content: assignment.scenarioVersion.content,
    },
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

  try {
    const attempt = await prisma.$transaction(async (tx) => {
      const active = await tx.attempt.findFirst({
        where: {
          candidateId: session.userId,
          status: { in: [AttemptStatus.IN_PROGRESS, AttemptStatus.SUBMITTED, AttemptStatus.SCORING] },
        },
        select: { id: true },
      });
      if (active) {
        throw new Error("ACTIVE_ATTEMPT_EXISTS");
      }

      const claimed = await tx.assignment.updateMany({
        where: {
          id: assignment.id,
          candidateId: session.userId,
          organizationId: session.organizationId,
          status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ABORTED, AssignmentStatus.TIMED_OUT] },
        },
        data: { status: AssignmentStatus.IN_PROGRESS },
      });
      if (claimed.count !== 1) {
        throw new Error("ASSIGNMENT_NOT_STARTABLE");
      }

      return tx.attempt.create({
        data: {
          assignmentId: assignment.id,
          candidateId: session.userId,
          scenarioVersionId: assignment.scenarioVersionId,
          organizationId: session.organizationId,
          expiresAt,
          startedAt,
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
        select: {
          id: true,
          status: true,
          startedAt: true,
          expiresAt: true,
        },
      });
    });

    const response: CandidateStartAttemptDto = {
      attempt: {
        id: attempt.id,
        status: "IN_PROGRESS",
        startedAt: attempt.startedAt.toISOString(),
        expiresAt: attempt.expiresAt.toISOString(),
      },
    };
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (
      message === "ACTIVE_ATTEMPT_EXISTS" ||
      message === "ASSIGNMENT_NOT_STARTABLE" ||
      message.includes("Unique constraint")
    ) {
      return NextResponse.json(
        { error: "You already have an active session. Complete or abort it first." },
        { status: 409 },
      );
    }
    throw err;
  }
}
