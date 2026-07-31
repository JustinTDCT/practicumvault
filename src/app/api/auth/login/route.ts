import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { saveUserSession } from "@/lib/auth";
import { checkLoginRateLimit, recordLoginAttempt, resolveClientIp } from "@/lib/auth/session";

const GENERIC_ERROR = "Invalid credentials";

/**
 * Fixed bcrypt hash used when no account exists so password verification
 * still performs comparable work (reduces account-enumeration timing skew).
 * Corresponds to a random high-entropy secret, never a real password.
 */
const DUMMY_PASSWORD_HASH =
  "$2b$12$uWcWRjY.cd72HltW.BtuQeJbLHxW6d/ikbrFKtwcMufl20xfGzi6e";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, password } = body;

  if (!email || !password) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  const normalizedEmail = String(email).toLowerCase();
  const ipAddress = resolveClientIp(request);

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });
  const accountExists = Boolean(user?.enabled);

  // Always perform password work (real hash or dummy) before responding.
  const passwordHash = accountExists && user ? user.passwordHash : DUMMY_PASSWORD_HASH;
  const validPassword = await verifyPassword(String(password), passwordHash);

  const rateCheck = await checkLoginRateLimit(normalizedEmail, ipAddress, { accountExists });
  if (!rateCheck.allowed) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  if (!accountExists || !validPassword || !user) {
    await recordLoginAttempt(normalizedEmail, false, ipAddress, { accountExists });
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  await recordLoginAttempt(normalizedEmail, true, ipAddress, { accountExists: true });
  await saveUserSession(user);

  return NextResponse.json({ success: true, role: user.role });
}

export async function DELETE() {
  const { getSession } = await import("@/lib/auth");
  const session = await getSession();
  session.destroy();
  return NextResponse.json({ success: true });
}
