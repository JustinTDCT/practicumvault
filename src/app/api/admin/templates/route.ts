import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getDefaultTemplateContent,
  validateRubricWeights,
  validateTemplateContent,
} from "@/lib/templates/schema";
import { deleteTemplateCascade, getTemplateDeletionStatus } from "@/lib/templates/deletion";
import { UserRole, TemplateStatus } from "@prisma/client";

export async function GET() {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const templates = await prisma.scenarioTemplate.findMany({
    where: { organizationId: session.organizationId },
    include: {
      versions: {
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { attempts: true, assignments: true } },
        },
      },
    },
    orderBy: { title: "asc" },
  });

  const withDeletionStatus = await Promise.all(
    templates.map(async (template) => {
      const deletion = await getTemplateDeletionStatus(template.id, session.organizationId);
      return {
        ...template,
        deletion: deletion ?? { canDelete: false, reason: "Unknown", completedAttempts: 0, activeAssignments: 0 },
      };
    }),
  );

  return NextResponse.json({ templates: withDeletionStatus });
}

export async function POST(request: NextRequest) {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { slug, title, description, timeLimitMinutes } = body;

  if (!slug || !title) {
    return NextResponse.json({ error: "Slug and title required" }, { status: 400 });
  }

  const normalizedSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  const existing = await prisma.scenarioTemplate.findFirst({
    where: { organizationId: session.organizationId, slug: normalizedSlug },
  });
  if (existing) {
    return NextResponse.json({ error: "Slug already exists" }, { status: 400 });
  }

  const content = getDefaultTemplateContent(title);
  content.metadata.title = title;
  content.metadata.description = description || "";

  const template = await prisma.scenarioTemplate.create({
    data: {
      slug: normalizedSlug,
      title,
      description: description || "",
      organizationId: session.organizationId,
      versions: {
        create: {
          version: "1.0",
          status: TemplateStatus.DRAFT,
          timeLimitMinutes: timeLimitMinutes || 45,
          content,
        },
      },
    },
    include: { versions: true },
  });

  return NextResponse.json({ template });
}

export async function PUT(request: NextRequest) {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { versionId, content, timeLimitMinutes, title, description } = body;

  const version = await prisma.scenarioVersion.findUnique({
    where: { id: versionId },
    include: { template: true, _count: { select: { attempts: true } } },
  });

  if (!version || version.template.organizationId !== session.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (version.status === TemplateStatus.DISABLED) {
    return NextResponse.json(
      { error: "This version is disabled. Create a new template or restore from a draft." },
      { status: 400 },
    );
  }

  let parsed;
  try {
    parsed = validateTemplateContent(content);
  } catch (e) {
    return NextResponse.json({ error: "Invalid template content", details: String(e) }, { status: 400 });
  }

  const weightError = validateRubricWeights(parsed);
  if (weightError) {
    return NextResponse.json({ error: weightError }, { status: 400 });
  }

  await prisma.scenarioTemplate.update({
    where: { id: version.templateId },
    data: {
      title: title || version.template.title,
      description: description ?? version.template.description,
    },
  });

  const updated = await prisma.scenarioVersion.update({
    where: { id: versionId },
    data: {
      content: parsed,
      timeLimitMinutes: timeLimitMinutes || version.timeLimitMinutes,
    },
  });

  return NextResponse.json({
    version: updated,
    warning:
      version._count.attempts > 0
        ? "This version has completed assessments. Content changed for future runs; historical reports unchanged."
        : undefined,
  });
}

export async function DELETE(request: NextRequest) {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { templateId } = body;

  if (!templateId) {
    return NextResponse.json({ error: "Template ID required" }, { status: 400 });
  }

  try {
    await deleteTemplateCascade(templateId, session.organizationId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed";
    const status = message === "Template not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
