import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/encryption";
import { UserRole, LlmProvider } from "@prisma/client";

export async function GET() {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
  });

  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    org: {
      ...org,
      anthropicApiKey: org.anthropicApiKey ? "configured" : "",
      openaiApiKey: org.openaiApiKey ? "configured" : "",
    },
  });
}

export async function PATCH(request: NextRequest) {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const data: Record<string, unknown> = {};

  if (body.name !== undefined) data.name = body.name;
  if (body.showCountdownTimer !== undefined) data.showCountdownTimer = body.showCountdownTimer;
  if (body.showElapsedTimer !== undefined) data.showElapsedTimer = body.showElapsedTimer;
  if (body.llmProvider !== undefined) data.llmProvider = body.llmProvider as LlmProvider;
  if (body.anthropicModel !== undefined) data.anthropicModel = body.anthropicModel;
  if (body.openaiModel !== undefined) data.openaiModel = body.openaiModel;
  if (body.localLlmModel !== undefined) data.localLlmModel = body.localLlmModel;
  if (body.localLlmBaseUrl !== undefined) data.localLlmBaseUrl = body.localLlmBaseUrl;

  if (body.anthropicApiKey && body.anthropicApiKey !== "configured") {
    data.anthropicApiKey = encrypt(body.anthropicApiKey);
  }
  if (body.openaiApiKey && body.openaiApiKey !== "configured") {
    data.openaiApiKey = encrypt(body.openaiApiKey);
  }

  const org = await prisma.organization.update({
    where: { id: session.organizationId },
    data,
  });

  return NextResponse.json({ success: true, org: { id: org.id } });
}
