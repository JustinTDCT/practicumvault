import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildTranscriptFilename,
  formatAttemptTranscript,
} from "@/lib/transcript/format-transcript";
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
      messages: { orderBy: { createdAt: "asc" } },
      scenarioVersion: { include: { template: true } },
    },
  });

  if (!attempt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const body = formatAttemptTranscript(attempt);
    const filename = buildTranscriptFilename(attempt);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
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
