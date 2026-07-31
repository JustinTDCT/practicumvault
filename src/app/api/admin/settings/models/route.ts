import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listAvailableModels } from "@/lib/ai/list-models";
import { LlmProvider, UserRole } from "@prisma/client";

export async function POST(request: NextRequest) {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const provider = body.provider as LlmProvider;

  if (!provider || !Object.values(LlmProvider).includes(provider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
  });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const models = await listAvailableModels({
      provider,
      org,
      anthropicApiKey: body.anthropicApiKey,
      openaiApiKey: body.openaiApiKey,
      localLlmBaseUrl: body.localLlmBaseUrl,
    });
    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list models" },
      { status: 400 },
    );
  }
}
