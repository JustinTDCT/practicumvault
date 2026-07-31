import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLatestPublishedVersion, allowAssignmentRetake } from "@/lib/attempts/service";
import { UserRole, AssignmentStatus, TemplateStatus } from "@prisma/client";

export async function GET() {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const assignments = await prisma.assignment.findMany({
    where: { organizationId: session.organizationId },
    include: {
      candidate: { include: { position: true } },
      scenarioVersion: { include: { template: true } },
      assignedBy: true,
      attempts: { orderBy: { startedAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ assignments });
}

export async function POST(request: NextRequest) {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { candidateId, templateId, positionId, notes } = body;

  if (!candidateId || !templateId) {
    return NextResponse.json({ error: "Candidate and template required" }, { status: 400 });
  }

  const version = await getLatestPublishedVersion(templateId);
  if (!version || version.status !== TemplateStatus.PUBLISHED) {
    return NextResponse.json({ error: "No published version available for this template" }, { status: 400 });
  }

  const assignment = await prisma.assignment.create({
    data: {
      candidateId,
      scenarioVersionId: version.id,
      assignedById: session.userId,
      positionId: positionId || null,
      notes: notes || "",
      organizationId: session.organizationId,
      status: AssignmentStatus.PENDING,
    },
    include: {
      candidate: true,
      scenarioVersion: { include: { template: true } },
    },
  });

  return NextResponse.json({ assignment });
}

export async function PATCH(request: NextRequest) {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { assignmentId, action } = body as { assignmentId?: string; action?: string };

  if (!assignmentId || action !== "allow_retake") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const assignment = await allowAssignmentRetake(assignmentId, session.organizationId);
    return NextResponse.json({ assignment });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to allow retake";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
