import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { getSession } from "@/lib/auth";
import { UserRole } from "@prisma/client";

export async function POST(request: NextRequest) {
  const existing = await prisma.organization.findFirst();
  if (existing?.setupComplete) {
    return NextResponse.json({ error: "Setup already completed" }, { status: 400 });
  }

  const body = await request.json();
  const { orgName, fullName, email, password } = body;

  if (!orgName || !fullName || !email || !password || password.length < 8) {
    return NextResponse.json({ error: "Invalid setup data" }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  const org = await prisma.organization.create({
    data: {
      name: orgName,
      setupComplete: true,
    },
  });

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      fullName,
      passwordHash,
      role: UserRole.ADMIN,
      isPrimaryAdmin: true,
      organizationId: org.id,
    },
  });

  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.role = user.role;
  session.organizationId = org.id;
  session.isLoggedIn = true;
  await session.save();

  return NextResponse.json({ success: true });
}
