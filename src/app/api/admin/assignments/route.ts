import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { allowAssignmentRetake } from "@/lib/attempts/service";
import { verifyOrgCandidate, verifyOrgPosition, verifyOrgTemplate, OrgAccessError } from "@/lib/org/verify";
import { canPublishTemplateContent, validateTemplateContent } from "@/lib/templates/schema";
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

  try {
    await verifyOrgCandidate(candidateId, session.organizationId);
    await verifyOrgTemplate(templateId, session.organizationId);
    if (positionId) {
      await verifyOrgPosition(positionId, session.organizationId);
    }
  } catch (err) {
    if (err instanceof OrgAccessError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }

  const version = await prisma.scenarioVersion.findFirst({
    where: {
      templateId,
      status: TemplateStatus.PUBLISHED,
      template: { organizationId: session.organizationId },
    },
    orderBy: { publishedAt: "desc" },
  });
  if (!version) {
    return NextResponse.json({ error: "No published version available for this template" }, { status: 400 });
  }

  const content = validateTemplateContent(version.content);
  const gate = canPublishTemplateContent(content);
  if (!gate.ok) {
    return NextResponse.json(
      {
        error: "This published scenario has unreviewed action specificity requirements. Edit and review actions before assigning.",
        issues: gate.issues,
      },
      { status: 400 },
    );
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
