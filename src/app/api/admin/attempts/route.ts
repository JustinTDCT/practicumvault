import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildReportData } from "@/lib/pdf/build-report-data";
import { AttemptReportDocument } from "@/lib/pdf/report";
import { UserRole } from "@prisma/client";

export async function GET() {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const attempts = await prisma.attempt.findMany({
    where: {
      organizationId: session.organizationId,
      status: { not: "IN_PROGRESS" },
    },
    include: {
      candidate: true,
      scenarioVersion: { include: { template: true } },
      assignment: { include: { position: true } },
    },
    orderBy: { startedAt: "desc" },
  });

  return NextResponse.json({
    attempts: attempts.map((a) => ({
      id: a.id,
      candidateName: a.candidate.fullName,
      scenarioTitle: a.scenarioVersion.template.title,
      version: a.scenarioVersion.version,
      status: a.status,
      overallScore: a.overallScore,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
    })),
  });
}

export async function PATCH(request: NextRequest) {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { attemptId, adminNotes } = body;

  if (!attemptId) {
    return NextResponse.json({ error: "Attempt ID required" }, { status: 400 });
  }

  const attempt = await prisma.attempt.update({
    where: { id: attemptId, organizationId: session.organizationId },
    data: { adminNotes: adminNotes ?? "" },
  });

  return NextResponse.json({ attempt: { id: attempt.id, adminNotes: attempt.adminNotes } });
}
