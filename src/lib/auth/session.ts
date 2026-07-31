import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/config/limits";

export function resolveClientIp(request: {
  headers: { get(name: string): string | null };
}): string | null {
  const trustProxy = process.env.TRUST_PROXY === "true";
  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0]?.trim() || null;
    }
  }
  return request.headers.get("x-real-ip")?.trim() || null;
}

export async function checkLoginRateLimit(
  email: string,
  ipAddress?: string | null,
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const since = new Date(Date.now() - LIMITS.loginWindowMs);
  const normalizedEmail = email.toLowerCase();

  const emailFailures = await prisma.loginAttempt.count({
    where: {
      email: normalizedEmail,
      success: false,
      createdAt: { gte: since },
    },
  });

  if (emailFailures >= LIMITS.loginMaxAttempts) {
    const oldest = await prisma.loginAttempt.findFirst({
      where: {
        email: normalizedEmail,
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

  if (ipAddress) {
    const ipFailures = await prisma.loginAttempt.count({
      where: {
        ipAddress,
        success: false,
        createdAt: { gte: since },
      },
    });
    if (ipFailures >= LIMITS.loginMaxAttemptsPerIp) {
      return { allowed: false, retryAfterMs: LIMITS.loginWindowMs };
    }
  }

  return { allowed: true };
}

export async function recordLoginAttempt(
  email: string,
  success: boolean,
  ipAddress?: string | null,
): Promise<void> {
  await prisma.loginAttempt.create({
    data: {
      email: email.toLowerCase(),
      success,
      ipAddress: ipAddress ?? null,
    },
  });

  // Opportunistic cleanup of old records
  if (Math.random() < 0.05) {
    const cutoff = new Date(Date.now() - LIMITS.loginAttemptRetentionMs);
    await prisma.loginAttempt.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
  }
}

export async function invalidateUserSessions(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
}
