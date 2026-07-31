import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { saveUserSession } from "@/lib/auth";
import { checkLoginRateLimit, recordLoginAttempt } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, password } = body;

  if (!email || !password) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase();
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  const rateCheck = await checkLoginRateLimit(normalizedEmail);
  if (!rateCheck.allowed) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user || !user.enabled) {
    await recordLoginAttempt(normalizedEmail, false, ipAddress);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordLoginAttempt(normalizedEmail, false, ipAddress);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  await recordLoginAttempt(normalizedEmail, true, ipAddress);
  await saveUserSession(user);

  return NextResponse.json({ success: true, role: user.role });
}

export async function DELETE() {
  const { getSession } = await import("@/lib/auth");
  const session = await getSession();
  session.destroy();
  return NextResponse.json({ success: true });
}
