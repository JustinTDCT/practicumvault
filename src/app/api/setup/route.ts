import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { saveUserSession } from "@/lib/auth";
import { requireBootstrapToken } from "@/lib/config/env";
import { UserRole } from "@prisma/client";

const SETUP_LOCK_KEY = 724531; // advisory lock key for initial setup

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { orgName, fullName, email, password, bootstrapToken } = body;

  try {
    requireBootstrapToken(bootstrapToken);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Setup not authorized" },
      { status: 403 },
    );
  }

  if (!orgName || !fullName || !email || !password || password.length < 8) {
    return NextResponse.json({ error: "Invalid setup data" }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`;

      const orgCount = await tx.organization.count();
      if (orgCount > 0) {
        throw new Error("SETUP_COMPLETE");
      }

      const org = await tx.organization.create({
        data: {
          name: orgName,
          setupComplete: true,
        },
      });

      const user = await tx.user.create({
        data: {
          email: email.toLowerCase(),
          fullName,
          passwordHash,
          role: UserRole.ADMIN,
          isPrimaryAdmin: true,
          organizationId: org.id,
        },
      });

      return { org, user };
    });

    await saveUserSession(result.user);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "SETUP_COMPLETE") {
      return NextResponse.json({ error: "Setup already completed" }, { status: 400 });
    }
    throw err;
  }
}
