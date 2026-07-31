import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildReportData } from "@/lib/pdf/build-report-data";
import { AttemptReportDocument } from "@/lib/pdf/report";
import { SnapshotIntegrityError } from "@/lib/attempts/snapshot";
import { UserRole } from "@prisma/client";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const attempt = await prisma.attempt.findUnique({
    where: { id, organizationId: session.organizationId },
    include: {
      candidate: true,
      scenarioVersion: { include: { template: true } },
      assignment: { include: { position: true } },
    },
  });

  if (!attempt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const reportData = buildReportData(attempt);
    const element = React.createElement(AttemptReportDocument, { data: reportData });
    // AttemptReportDocument renders a @react-pdf Document root; cast satisfies renderToBuffer typing.
    const buffer = await renderToBuffer(
      element as Parameters<typeof renderToBuffer>[0],
    );

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="practicum-report-${reportData.scenarioSlug}-${attempt.id.slice(0, 8)}.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof SnapshotIntegrityError
            ? err.message
            : "Historical scenario snapshot is missing or invalid. Run snapshot backfill.",
      },
      { status: 409 },
    );
  }
}
