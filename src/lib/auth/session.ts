import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/config/limits";

export async function checkLoginRateLimit(email: string): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const since = new Date(Date.now() - LIMITS.loginWindowMs);
  const failures = await prisma.loginAttempt.count({
    where: {
      email: email.toLowerCase(),
      success: false,
      createdAt: { gte: since },
    },
  });

  if (failures >= LIMITS.loginMaxAttempts) {
    const oldest = await prisma.loginAttempt.findFirst({
      where: {
        email: email.toLowerCase(),
        success: false,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "asc" },
    });
    const retryAfterMs = oldest
      ? Math.max(0, oldest.createdAt.getTime() + LIMITS.loginWindowMs - Date.now())
      : LIMITS.loginWindowMs;
    return { allowed: false, retryAfterMs };
  }

  const backoffMs = failures > 0 ? LIMITS.loginBackoffBaseMs * Math.pow(2, failures - 1) : 0;
  if (backoffMs > 0) {
    await new Promise((r) => setTimeout(r, Math.min(backoffMs, 8000)));
  }

  return { allowed: true };
}

export async function recordLoginAttempt(email: string, success: boolean, ipAddress?: string): Promise<void> {
  await prisma.loginAttempt.create({
    data: {
      email: email.toLowerCase(),
      success,
      ipAddress: ipAddress ?? null,
    },
  });
}

export async function invalidateUserSessions(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
}
