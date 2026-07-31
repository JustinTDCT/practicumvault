import crypto from "crypto";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/config/limits";

function hashKey(kind: "email" | "ip", value: string): string {
  const digest = crypto.createHash("sha256").update(`${kind}:${value.toLowerCase()}`).digest("hex");
  return `${kind}:${digest.slice(0, 40)}`;
}

function currentWindowStart(now = Date.now()): Date {
  const windowMs = LIMITS.loginWindowMs;
  return new Date(Math.floor(now / windowMs) * windowMs);
}

/**
 * Only honor forwarded headers when TRUST_PROXY=true.
 * When disabled, do not trust x-forwarded-for or x-real-ip from the request.
 */
export function resolveClientIp(request: {
  headers: { get(name: string): string | null };
}): string | null {
  if (process.env.TRUST_PROXY !== "true") {
    return null;
  }
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || null;
  }
  return request.headers.get("x-real-ip")?.trim() || null;
}

async function getBucketCount(bucketKey: string): Promise<number> {
  const windowStart = currentWindowStart();
  const bucket = await prisma.loginRateBucket.findUnique({
    where: { bucketKey_windowStart: { bucketKey, windowStart } },
  });
  return bucket?.failureCount ?? 0;
}

async function incrementBucket(bucketKey: string): Promise<number> {
  const windowStart = currentWindowStart();
  const bucket = await prisma.loginRateBucket.upsert({
    where: { bucketKey_windowStart: { bucketKey, windowStart } },
    create: { bucketKey, windowStart, failureCount: 1 },
    update: { failureCount: { increment: 1 } },
  });
  return bucket.failureCount;
}

async function resetBucket(bucketKey: string): Promise<void> {
  const windowStart = currentWindowStart();
  await prisma.loginRateBucket.deleteMany({
    where: { bucketKey, windowStart },
  });
}

export async function cleanupLoginRateBuckets(): Promise<number> {
  const cutoff = new Date(Date.now() - LIMITS.loginAttemptRetentionMs);
  const result = await prisma.loginRateBucket.deleteMany({
    where: { windowStart: { lt: cutoff } },
  });
  await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}

export async function checkLoginRateLimit(
  email: string,
  ipAddress?: string | null,
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const emailKey = hashKey("email", email);
  const emailFailures = await getBucketCount(emailKey);
  if (emailFailures >= LIMITS.loginMaxAttempts) {
    const windowStart = currentWindowStart();
    const retryAfterMs = Math.max(0, windowStart.getTime() + LIMITS.loginWindowMs - Date.now());
    return { allowed: false, retryAfterMs };
  }

  if (ipAddress) {
    const ipKey = hashKey("ip", ipAddress);
    const ipFailures = await getBucketCount(ipKey);
    if (ipFailures >= LIMITS.loginMaxAttemptsPerIp) {
      const windowStart = currentWindowStart();
      const retryAfterMs = Math.max(0, windowStart.getTime() + LIMITS.loginWindowMs - Date.now());
      return { allowed: false, retryAfterMs };
    }
  }

  return { allowed: true };
}

export async function recordLoginAttempt(
  email: string,
  success: boolean,
  ipAddress?: string | null,
): Promise<void> {
  const normalizedEmail = email.toLowerCase();
  const emailKey = hashKey("email", normalizedEmail);

  if (success) {
    await resetBucket(emailKey);
    if (ipAddress) {
      await resetBucket(hashKey("ip", ipAddress));
    }
    // Audit success without growing forever for random usernames
    await prisma.loginAttempt.create({
      data: {
        email: normalizedEmail,
        success: true,
        ipAddress: ipAddress ?? null,
      },
    });
  } else {
    await incrementBucket(emailKey);
    if (ipAddress) {
      await incrementBucket(hashKey("ip", ipAddress));
    }
    // Store hashed email for unknown/failed attempts to bound storage growth
    await prisma.loginAttempt.create({
      data: {
        email: emailKey,
        success: false,
        ipAddress: ipAddress ? hashKey("ip", ipAddress) : null,
      },
    });
  }

  // Deterministic opportunistic cleanup every ~20 writes via second digit of hash
  if (parseInt(emailKey.slice(-2), 16) % 20 === 0) {
    await cleanupLoginRateBuckets();
  }
}

export async function invalidateUserSessions(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
}
