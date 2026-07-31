import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "../../src/lib/config/limits";
import {
  checkLoginRateLimit,
  cleanupLoginRateBuckets,
  recordLoginAttempt,
  resolveClientIp,
} from "../../src/lib/auth/session";
import { prisma, requireTestDatabase, resetTestDatabase } from "./helpers";

function requestWithHeaders(headers: Record<string, string>) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    headers: {
      get(name: string) {
        return normalized.get(name.toLowerCase()) ?? null;
      },
    },
  };
}

describe("login limiter (integration)", () => {
  const originalTrustProxy = process.env.TRUST_PROXY;

  beforeAll(() => {
    requireTestDatabase();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    process.env.TRUST_PROXY = originalTrustProxy;
  });

  afterAll(async () => {
    process.env.TRUST_PROXY = originalTrustProxy;
    await prisma.$disconnect();
  });

  it("ignores forwarded IP headers when TRUST_PROXY is false", () => {
    process.env.TRUST_PROXY = "false";
    const ip = resolveClientIp(requestWithHeaders({
      "x-real-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.1",
    }));

    expect(ip).toBeNull();
  });

  it("uses the first x-forwarded-for IP when TRUST_PROXY is true", () => {
    process.env.TRUST_PROXY = "true";
    const ip = resolveClientIp(requestWithHeaders({
      "x-real-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.1, 198.51.100.2",
    }));

    expect(ip).toBe("198.51.100.1");
  });

  it("success resets account failure state", async () => {
    const email = "candidate@test.local";
    for (let index = 0; index < LIMITS.loginMaxAttempts; index += 1) {
      await recordLoginAttempt(email, false, null);
    }
    expect(await checkLoginRateLimit(email, null)).toMatchObject({ allowed: false });

    await recordLoginAttempt(email, true, null);

    expect(await checkLoginRateLimit(email, null)).toEqual({ allowed: true });
    expect(await prisma.loginRateBucket.count()).toBe(0);
    const success = await prisma.loginAttempt.findFirstOrThrow({ where: { success: true } });
    expect(success.email).toBe(email);
  });

  it("account windows limit only the failed account", async () => {
    const blockedEmail = "blocked-account@test.local";
    for (let index = 0; index < LIMITS.loginMaxAttempts; index += 1) {
      await recordLoginAttempt(blockedEmail, false, null);
    }

    expect(await checkLoginRateLimit(blockedEmail, "198.51.100.55")).toMatchObject({
      allowed: false,
    });
    expect(await checkLoginRateLimit("other-account@test.local", "198.51.100.55")).toEqual({
      allowed: true,
    });
  });

  it("IP windows limit independently of account windows", async () => {
    const ip = "198.51.100.88";
    for (let index = 0; index < LIMITS.loginMaxAttemptsPerIp; index += 1) {
      await recordLoginAttempt(`ip-failure-${index}@test.local`, false, ip);
    }

    expect(await checkLoginRateLimit("fresh-account@test.local", ip)).toMatchObject({
      allowed: false,
    });
    expect(await checkLoginRateLimit("fresh-account@test.local", null)).toEqual({
      allowed: true,
    });
  });

  it("cleanup removes old buckets and old audit rows", async () => {
    const staleDate = new Date(Date.now() - LIMITS.loginAttemptRetentionMs - 60_000);
    await prisma.loginRateBucket.create({
      data: {
        bucketKey: "email:stale",
        windowStart: staleDate,
        failureCount: 3,
      },
    });
    await prisma.loginAttempt.create({
      data: {
        email: "email:stale",
        ipAddress: "ip:stale",
        success: false,
        createdAt: staleDate,
      },
    });

    const removed = await cleanupLoginRateBuckets();

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await prisma.loginRateBucket.count()).toBe(0);
    expect(await prisma.loginAttempt.count()).toBe(0);
  });
});
