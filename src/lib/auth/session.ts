import "server-only";

import crypto from "crypto";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/config/limits";

export const ANONYMOUS_BUCKET = "anonymous:global";

function hashKey(kind: "email" | "ip", value: string): string {
  const digest = crypto.createHash("sha256").update(`${kind}:${value.toLowerCase()}`).digest("hex");
  return `${kind}:${digest.slice(0, 40)}`;
}

function currentWindowStart(now = Date.now()): Date {
  const windowMs = LIMITS.loginWindowMs;
  return new Date(Math.floor(now / windowMs) * windowMs);
}

function retryAfterMs(): number {
  const windowStart = currentWindowStart();
  return Math.max(0, windowStart.getTime() + LIMITS.loginWindowMs - Date.now());
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

export type LoginRateOptions = {
  /** True only when the email matches an enabled account. */
  accountExists: boolean;
};

/**
 * Rate-limit rules:
 * - Trusted IP present: check account bucket (enabled accounts) + IP bucket (all requests).
 * - No trusted IP: enabled accounts use only the account bucket; unknown accounts use anonymous:global.
 * - Unknown-account anonymous traffic must never lock out enabled accounts.
 */
export async function checkLoginRateLimit(
  email: string,
  ipAddress?: string | null,
  options: LoginRateOptions = { accountExists: false },
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  if (options.accountExists) {
    const emailFailures = await getBucketCount(hashKey("email", email));
    if (emailFailures >= LIMITS.loginMaxAttempts) {
      return { allowed: false, retryAfterMs: retryAfterMs() };
    }
    if (ipAddress) {
      const ipFailures = await getBucketCount(hashKey("ip", ipAddress));
      if (ipFailures >= LIMITS.loginMaxAttemptsPerIp) {
        return { allowed: false, retryAfterMs: retryAfterMs() };
      }
    }
    // Enabled accounts ignore anonymous:global
    return { allowed: true };
  }

  if (ipAddress) {
    const ipFailures = await getBucketCount(hashKey("ip", ipAddress));
    if (ipFailures >= LIMITS.loginMaxAttemptsPerIp) {
      return { allowed: false, retryAfterMs: retryAfterMs() };
    }
  } else {
    const anonFailures = await getBucketCount(ANONYMOUS_BUCKET);
    if (anonFailures >= LIMITS.loginMaxAttemptsPerIp) {
      return { allowed: false, retryAfterMs: retryAfterMs() };
    }
  }

  return { allowed: true };
}

/**
 * Record login outcome.
 * Success resets only the account bucket — never shared IP/global attack buckets.
 * Unknown emails never create per-email buckets.
 * Retention cleanup runs after every recorded attempt.
 */
export async function recordLoginAttempt(
  email: string,
  success: boolean,
  ipAddress?: string | null,
  options: LoginRateOptions = { accountExists: false },
): Promise<void> {
  const normalizedEmail = email.toLowerCase();
  const emailKey = hashKey("email", normalizedEmail);

  if (success) {
    if (options.accountExists) {
      await resetBucket(emailKey);
    }
    await prisma.loginAttempt.create({
      data: {
        email: normalizedEmail,
        success: true,
        ipAddress: ipAddress ?? null,
      },
    });
  } else if (options.accountExists) {
    await incrementBucket(emailKey);
    if (ipAddress) {
      await incrementBucket(hashKey("ip", ipAddress));
    }
    await prisma.loginAttempt.create({
      data: {
        email: emailKey,
        success: false,
        ipAddress: ipAddress ? hashKey("ip", ipAddress) : null,
      },
    });
  } else if (ipAddress) {
    await incrementBucket(hashKey("ip", ipAddress));
  } else {
    await incrementBucket(ANONYMOUS_BUCKET);
  }

  await cleanupLoginRateBuckets();
}

export async function invalidateUserSessions(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
}
