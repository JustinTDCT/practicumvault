import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { UserRole } from "@prisma/client";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth([UserRole.ADMIN]);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const data: Record<string, unknown> = {};
  if (body.fullName !== undefined) data.fullName = body.fullName;
  if (body.enabled !== undefined) data.enabled = body.enabled;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.positionId !== undefined) data.positionId = body.positionId || null;
  if (body.password) {
    if (body.password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    data.passwordHash = await hashPassword(body.password);
  }

  const user = await prisma.user.update({
    where: { id, organizationId: session.organizationId },
    data,
    include: { position: true },
  });

  return NextResponse.json({ user: { ...user, passwordHash: undefined } });
}
