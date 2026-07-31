import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";

export async function GET() {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const positions = await prisma.position.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ positions });
}

export async function POST(request: NextRequest) {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { name, description } = body;

  if (!name) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }

  try {
    const position = await prisma.position.create({
      data: {
        name,
        description: description || "",
        organizationId: session.organizationId,
      },
    });
    return NextResponse.json({ position });
  } catch {
    return NextResponse.json({ error: "Position name already exists" }, { status: 400 });
  }
}
