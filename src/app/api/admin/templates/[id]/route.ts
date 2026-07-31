import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { UserRole, TemplateStatus } from "@prisma/client";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: versionId } = await params;
  const body = await request.json();
  const action = body.action as "publish" | "disable" | "new_version";

  const version = await prisma.scenarioVersion.findUnique({
    where: { id: versionId },
    include: { template: true },
  });

  if (!version || version.template.organizationId !== session.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (action === "publish") {
    if (version.status !== TemplateStatus.DRAFT) {
      return NextResponse.json({ error: "Only drafts can be published" }, { status: 400 });
    }
    const updated = await prisma.scenarioVersion.update({
      where: { id: versionId },
      data: { status: TemplateStatus.PUBLISHED, publishedAt: new Date() },
    });
    return NextResponse.json({ version: updated });
  }

  if (action === "disable") {
    const updated = await prisma.scenarioVersion.update({
      where: { id: versionId },
      data: { status: TemplateStatus.DISABLED },
    });
    return NextResponse.json({ version: updated });
  }

  if (action === "new_version") {
    const latest = await prisma.scenarioVersion.findMany({
      where: { templateId: version.templateId },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    const parts = (latest[0]?.version || "1.0").split(".").map(Number);
    const nextVersion = `${parts[0]}.${(parts[1] || 0) + 1}`;

    const newVersion = await prisma.scenarioVersion.create({
      data: {
        templateId: version.templateId,
        version: nextVersion,
        status: TemplateStatus.DRAFT,
        timeLimitMinutes: version.timeLimitMinutes,
        content: version.content as object,
      },
    });
    return NextResponse.json({ version: newVersion });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
