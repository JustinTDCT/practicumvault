import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { UserRole } from "@prisma/client";

export async function GET() {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const users = await prisma.user.findMany({
    where: { organizationId: session.organizationId },
    include: { position: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ users });
}

export async function POST(request: NextRequest) {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { email, fullName, password, role, positionId, notes } = body;

  if (!email || !fullName || !password || !role) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    return NextResponse.json({ error: "Email already in use" }, { status: 400 });
  }

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      fullName,
      passwordHash: await hashPassword(password),
      role: role as UserRole,
      positionId: positionId || null,
      notes: notes || "",
      organizationId: session.organizationId,
    },
    include: { position: true },
  });

  return NextResponse.json({ user: { ...user, passwordHash: undefined } });
}
